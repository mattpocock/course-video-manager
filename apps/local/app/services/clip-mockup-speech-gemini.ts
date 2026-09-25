import { Clock, Data, Duration, Effect, Schedule } from "effect";
import type { RateLimiter } from "effect";

/**
 * THE PRIVATE LOWER HALF OF `clip-mockup-speech-service.ts` — everything that
 * knows Gemini exists.
 *
 * Import the SERVICE, not this: `ClipMockupSpeechService.synthesizeLine` is
 * the one entry point, and the whole point of the split is that no caller has
 * to know there is a retry policy, a rate limit or an HTTP status code
 * anywhere near a Clip Mockup's line. This file is its own module only
 * because the two halves together exceed the repo's per-file token budget;
 * the public names it declares are re-exported from the service.
 *
 * What lives here: the ONE voice and the ONE model, the HTTP seam, the reading
 * of Google's refusal, and the policy that decides whether asking again could
 * possibly help.
 */

/** The single Gemini prebuilt voice every Clip Mockup line is read in. */
export const CLIP_MOCKUP_VOICE = "Leda";

/** The single Gemini TTS model every Clip Mockup line is read by. */
export const CLIP_MOCKUP_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** The environment variable holding the Gemini key. */
export const GEMINI_API_KEY_ENV_KEY = "GEMINI_API_KEY";

/** The sample rate assumed when Gemini's mimeType does not state one. */
export const DEFAULT_SAMPLE_RATE = 24000;

/** The one endpoint this module talks to. */
const TTS_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${CLIP_MOCKUP_TTS_MODEL}:generateContent`;

/**
 * THE PACE AND THE BACKOFF — all four numbers, here, beside the model.
 *
 * `TTS_REQUESTS_PER_INTERVAL` matches the model's published per-minute cap, so
 * the common case never earns a 429 in the first place.
 *
 * WHAT THE RATE LIMITER DOES NOT COVER, and this is the important part: `cvm`
 * is ONE PROCESS PER INVOCATION. An agent that runs `cvm clip-mockup add`
 * three hundred times runs three hundred processes, each with its own fresh
 * limiter, and they do not see each other — which is exactly the run that
 * exhausted the daily quota. This paces the calls WITHIN a single process (a
 * multi-chunk line today, any bulk verb tomorrow) and nothing more. Pacing
 * across processes would need a shared clock on disk; that is a separate,
 * deliberate decision and is NOT made here.
 */
export const TTS_REQUESTS_PER_INTERVAL = 3;
export const TTS_RATE_INTERVAL: Duration.DurationInput = "1 minute";

/**
 * The backoff. Four attempts rather than the three the hand-rolled loop made:
 * a retry is now only ever spent on a failure that can actually clear, so one
 * more of them is cheap. `Schedule.jittered` is not decoration — the incident
 * was parallel agent processes, and un-jittered backoff resynchronises them
 * into a thundering herd on the same second.
 */
export const TTS_RETRY_BASE_DELAY: Duration.DurationInput = "1 second";
export const TTS_MAX_RETRIES = 3;

/** Statuses that may clear on their own: a per-minute squeeze, or a wobble. */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Anything that stopped a line from being voiced: no key, a 4xx, a 200 with no
 * audio in it. One tag, because the caller's response to every one of them is
 * the same — the Clip Mockup is not created, and a human reads the message.
 * Unmapped in the CLI's exit-code table on purpose: it is an internal failure,
 * exit 4.
 */
export class SpeechSynthesisError extends Data.TaggedError(
  "SpeechSynthesisError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * A failure that may clear if we simply ask again: a per-MINUTE rate squeeze,
 * a 5xx, a socket that never opened.
 *
 * INTERNAL. It is the only thing the retry schedule is allowed to act on, and
 * it never reaches the CLI: once the retries are spent it is wrapped in a
 * `SpeechSynthesisError`, because "the voice fell over" is the same fact to a
 * caller whether it fell over once or four times.
 *
 * `retryAfter` is the server's OWN answer when it gave one (RetryInfo), and it
 * beats anything we would have computed.
 */
export class TtsTransientError extends Data.TaggedError("TtsTransientError")<{
  /** The HTTP status, or `undefined` when the request never landed. */
  readonly status: number | undefined;
  readonly retryAfter: Duration.Duration | undefined;
  readonly cause: unknown;
  readonly message: string;
}> {}

/**
 * The DAILY cap is spent. A different fact from every other failure, and it
 * gets its own tag because it demands a different decision.
 *
 * Waiting is not a thing a CLI process may do here: the observed reset was six
 * and a half HOURS away. So this fails fast, carrying the two numbers the
 * human actually needs — how many requests the cap is, and when it comes back —
 * and the CLI prints them in one line instead of a raw JSON blob. It is never
 * retried: no number of attempts can beat a quota that resets tomorrow.
 *
 * The discriminator is the server's `quotaId` (a daily cap says `PerDay`), NOT
 * the status code: a per-minute squeeze arrives as the same 429.
 */
export class TtsQuotaExhaustedError extends Data.TaggedError(
  "TtsQuotaExhaustedError"
)<{
  /** e.g. "GenerateRequestsPerDayPerProjectPerModel". */
  readonly quotaId: string | undefined;
  /** The cap itself, as the server states it — e.g. "100". */
  readonly quotaValue: string | undefined;
  /** When the cap comes back, as an ISO instant. */
  readonly resetsAt: string;
  readonly retryAfterSeconds: number | undefined;
  readonly message: string;
}> {}

/** Everything that can stop a chunk being voiced. */
type SpeechFailure =
  SpeechSynthesisError | TtsTransientError | TtsQuotaExhaustedError;

/** Words in a string — the chunker's budget and the refusal message share it. */
export const wordCount = (s: string) =>
  s.trim() ? s.trim().split(/\s+/).length : 0;

type GeminiTtsResponse = {
  candidates?: {
    finishReason?: string;
    content?: {
      parts?: {
        inlineData?: { data: string; mimeType: string };
        text?: string;
      }[];
    };
  }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
};

/**
 * Explain a 200 that carried no audio. A refusal, a safety block and a
 * token-limit truncation all arrive as a cheerful success, and the only thing
 * that tells the author which one happened is this message.
 */
function describeMissingAudio(json: GeminiTtsResponse, chunk: string): string {
  const parts: string[] = [];
  const block = json.promptFeedback?.blockReason;
  if (block) {
    parts.push(
      `the prompt was blocked (${block}${
        json.promptFeedback?.blockReasonMessage
          ? `: ${json.promptFeedback.blockReasonMessage}`
          : ""
      })`
    );
  }
  const finish = json.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") parts.push(`finishReason ${finish}`);
  const text = json.candidates?.[0]?.content?.parts?.find(
    (p) => typeof p.text === "string"
  )?.text;
  if (text) parts.push(`it answered with text instead of audio: ${text}`);
  if (parts.length === 0) parts.push("no inlineData part was present");
  const snippet = chunk.length > 120 ? `${chunk.slice(0, 120)}…` : chunk;
  return `Gemini TTS returned no audio for a ${wordCount(
    chunk
  )}-word line — ${parts.join("; ")}. Line: "${snippet}"`;
}

/**
 * The seam Gemini sits behind: one method, a chunk in, a raw status and body
 * out. No parsing, no policy, no retrying — all of that is below, where it can
 * be read in one place.
 *
 * It exists for exactly one reason: HTTP is a system boundary, and a test has
 * to be able to hand this module a 429 body byte-for-byte as Google sends it
 * without a network. Nothing else in here is faked.
 *
 * `@effect/platform`'s HttpClient would be the other way to draw this seam,
 * but nothing in this repo uses it — `@effect/platform` appears only as
 * FileSystem, Command and NodeContext — so a `fetch` behind a tag keeps the
 * idiom local instead of starting a migration nobody asked for.
 */
export interface TtsHttpResponse {
  readonly status: number;
  /** The raw body text. The 429 case needs it verbatim. */
  readonly body: string;
}

export class GeminiTtsTransport extends Effect.Service<GeminiTtsTransport>()(
  "GeminiTtsTransport",
  {
    sync: () => ({
      post: (input: {
        readonly apiKey: string;
        readonly chunk: string;
      }): Effect.Effect<TtsHttpResponse, TtsTransientError> =>
        Effect.tryPromise({
          try: async () => {
            const res = await fetch(TTS_ENDPOINT, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-goog-api-key": input.apiKey,
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: input.chunk }] }],
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: CLIP_MOCKUP_VOICE },
                    },
                  },
                },
              }),
            });
            return { status: res.status, body: await res.text() };
          },
          // A request that never landed is transient by definition.
          catch: (cause) =>
            new TtsTransientError({
              status: undefined,
              retryAfter: undefined,
              cause,
              message: `Gemini TTS could not be reached: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            }),
        }),
    }),
  }
) {}

/** The error envelope Google returns with a 4xx — google.rpc status details. */
type GeminiErrorBody = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: ReadonlyArray<{
      "@type"?: string;
      /** RetryInfo, a protobuf duration: "23693s". */
      retryDelay?: string;
      /** QuotaFailure. */
      violations?: ReadonlyArray<{
        quotaId?: string;
        quotaMetric?: string;
        quotaValue?: string;
      }>;
    }>;
  };
};

const parseRetryDelay = (raw: unknown): Duration.Duration | undefined => {
  if (typeof raw !== "string") return undefined;
  const seconds = Number(raw.replace(/s$/, ""));
  return Number.isFinite(seconds) && seconds >= 0
    ? Duration.seconds(seconds)
    : undefined;
};

/**
 * What the server actually said about the refusal.
 *
 * The 429 body is not an opaque blob: it carries a `RetryInfo.retryDelay` and
 * a `QuotaFailure` naming the violated `quotaId` and its value. Reading them
 * is the difference between backing off 1s against a cap that resets in six
 * hours, and saying so.
 */
const readQuotaAnswer = (
  body: string
): {
  readonly retryAfter: Duration.Duration | undefined;
  readonly quotaId: string | undefined;
  readonly quotaValue: string | undefined;
  /** A PER-DAY cap, as opposed to a per-minute squeeze wearing the same 429. */
  readonly daily: boolean;
} => {
  let parsed: GeminiErrorBody | undefined;
  try {
    parsed = JSON.parse(body) as GeminiErrorBody;
  } catch {
    parsed = undefined;
  }
  const details = parsed?.error?.details ?? [];
  const retryInfo = details.find((d) => d["@type"]?.endsWith("RetryInfo"));
  const violation = details.flatMap((d) => d.violations ?? [])[0];
  return {
    retryAfter: parseRetryDelay(retryInfo?.retryDelay),
    quotaId: violation?.quotaId,
    quotaValue: violation?.quotaValue,
    daily:
      /perday/i.test(violation?.quotaId ?? "") ||
      /per_day/i.test(violation?.quotaMetric ?? ""),
  };
};

/**
 * Turn a non-2xx answer into the one of three failures it actually is.
 *
 * Reads the clock through Effect so `resetsAt` is a real instant a human can
 * act on, and so a test can assert it without waiting for one.
 */
const refuse = (
  response: TtsHttpResponse
): Effect.Effect<never, SpeechFailure> =>
  Effect.gen(function* () {
    const quota = readQuotaAnswer(response.body);

    if (response.status === 429 && quota.daily) {
      const retryAfter = quota.retryAfter ?? Duration.hours(24);
      const now = yield* Clock.currentTimeMillis;
      const resetsAt = new Date(
        now + Duration.toMillis(retryAfter)
      ).toISOString();
      const cap =
        quota.quotaValue === undefined
          ? ""
          : ` of ${quota.quotaValue} requests`;
      return yield* new TtsQuotaExhaustedError({
        quotaId: quota.quotaId,
        quotaValue: quota.quotaValue,
        resetsAt,
        retryAfterSeconds: Math.round(Duration.toSeconds(retryAfter)),
        message:
          `The daily Gemini TTS quota${cap} for ${CLIP_MOCKUP_TTS_MODEL} is spent; ` +
          `it resets at ${resetsAt}, in ${Duration.format(retryAfter)}. ` +
          `Nothing was spoken. Wait for the reset or raise the cap — retrying before then cannot succeed.`,
      });
    }

    if (TRANSIENT_STATUS.has(response.status)) {
      return yield* new TtsTransientError({
        status: response.status,
        retryAfter: quota.retryAfter,
        cause: null,
        message: `Gemini TTS ${response.status}: ${response.body}`,
      });
    }

    return yield* new SpeechSynthesisError({
      cause: null,
      message: `Gemini TTS ${response.status}: ${response.body}`,
    });
  });

/** Everything one voiced chunk needs: the boundary, the pace, the key. */
export interface TtsCaller {
  readonly transport: GeminiTtsTransport;
  readonly limit: RateLimiter.RateLimiter;
  readonly apiKey: string;
}

/** One request, one answer — no retrying, no pacing. */
const requestChunk = (chunk: string, caller: TtsCaller) =>
  Effect.gen(function* () {
    const response = yield* caller.transport.post({
      apiKey: caller.apiKey,
      chunk,
    });
    if (response.status < 200 || response.status >= 300) {
      return yield* refuse(response);
    }
    const json = yield* Effect.try({
      try: () => JSON.parse(response.body) as GeminiTtsResponse,
      catch: (cause) =>
        new SpeechSynthesisError({
          cause,
          message: `Gemini TTS answered 200 with a body that is not JSON: ${response.body.slice(
            0,
            200
          )}`,
        }),
    });
    const inline = json.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData
    )?.inlineData;
    if (!inline) {
      return yield* new SpeechSynthesisError({
        cause: null,
        message: describeMissingAudio(json, chunk),
      });
    }
    // mimeType looks like "audio/L16;rate=24000".
    const rate = Number(
      inline.mimeType.match(/rate=(\d+)/)?.[1] ?? DEFAULT_SAMPLE_RATE
    );
    return { pcm: Buffer.from(inline.data, "base64"), rate };
  });

/**
 * The whole retry policy, as one value.
 *
 * Read it inside out: exponential from `TTS_RETRY_BASE_DELAY`, JITTERED so two
 * agent processes that hit the same 429 do not come back on the same second;
 * the server's own `retryDelay` preferred over that computed delay wherever it
 * gave one; bounded by `TTS_MAX_RETRIES`; and gated by `whileInput` so it only
 * ever fires on a `TtsTransientError`. A `TtsQuotaExhaustedError` walks
 * straight out on the first attempt, which is the entire point — the old loop
 * spent three calls and eight seconds on a cap that resets tomorrow.
 */
const ttsRetrySchedule = Schedule.identity<SpeechFailure>().pipe(
  Schedule.intersect(
    Schedule.exponential(TTS_RETRY_BASE_DELAY, 2).pipe(Schedule.jittered)
  ),
  Schedule.modifyDelay(([failure], computed) =>
    failure._tag === "TtsTransientError" && failure.retryAfter !== undefined
      ? failure.retryAfter
      : computed
  ),
  Schedule.intersect(Schedule.recurs(TTS_MAX_RETRIES)),
  Schedule.whileInput(
    (failure: SpeechFailure) => failure._tag === "TtsTransientError"
  )
);

/** Voice one chunk: paced, and retried only where retrying can work. */
export const synthesizeChunk = (chunk: string, caller: TtsCaller) =>
  caller
    .limit(requestChunk(chunk, caller))
    .pipe(Effect.retry(ttsRetrySchedule));
