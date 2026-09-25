import { describe, expect, it } from "@effect/vitest";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { Clock, Effect, Fiber, Layer, TestClock } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  ClipMockupSpeechService,
  GeminiTtsTransport,
  speechFilename,
  type TtsHttpResponse,
} from "./clip-mockup-speech-service";
import {
  ACCESS_TOKEN_ENV_KEY,
  forgetGoogleAuth,
  PROJECT_ENV_KEY,
} from "./google-adc";
import { CLIP_MOCKUP_DIR_ENV_KEY } from "./clip-mockup-files";
import { resolveClipMockupSpeech } from "./resolve-clip-mockup-speech";

// ===========================================================================
// What the speech service does with a REFUSAL.
//
// The incident this file is the memory of: an agent authoring ~300 Clip
// Mockups ran into the per-DAY TTS quota, and the service — which treated
// every 429 as a wobble — spent three calls and eight seconds backing off
// against a cap that would not reset for six and a half hours, then failed
// with the reset time buried in a raw JSON blob.
//
// So the behaviour asserted here is: the server's own answer is READ (the
// quotaId says which cap, RetryInfo says when it comes back), a daily cap
// stops the run at once with both numbers where a human can see them, a
// per-minute squeeze is retried, and a cached line costs NO REQUEST AT ALL —
// which is the biggest lever on the quota there is.
//
// Every clock here is Effect's TestClock: a suite that really waits thirty
// seconds is a suite nobody runs. The HTTP boundary is faked; nothing in this
// file can reach Gemini.
// ===========================================================================

// The credential seam. Setting an access token outright is what stops
// `resolveGoogleAuth` reading the developer's own ADC file and spending a
// refresh grant on a suite that never makes a request: the transport below is
// faked, so this token is handed over and then thrown away.
const originalToken = process.env[ACCESS_TOKEN_ENV_KEY];
const originalProject = process.env[PROJECT_ENV_KEY];

const restore = (key: string, was: string | undefined) => {
  if (was === undefined) delete process.env[key];
  else process.env[key] = was;
};

beforeAll(() => {
  process.env[ACCESS_TOKEN_ENV_KEY] = "test-token-never-used";
  process.env[PROJECT_ENV_KEY] = "test-project-never-billed";
  forgetGoogleAuth();
});

afterAll(() => {
  restore(ACCESS_TOKEN_ENV_KEY, originalToken);
  restore(PROJECT_ENV_KEY, originalProject);
  forgetGoogleAuth();
});

// ---------------------------------------------------------------------------
// The bodies, verbatim in shape from what Gemini actually returned.
// ---------------------------------------------------------------------------

/** The 429 from the incident: a PER-DAY cap of 100, resetting in 6h34m53s. */
const DAILY_QUOTA_429 = JSON.stringify({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message:
      "You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 100. Please retry in 6h34m53s.",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric:
              "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel",
            quotaDimensions: {
              location: "global",
              model: "gemini-2.5-flash-tts",
            },
            quotaValue: "100",
          },
        ],
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "23693s",
      },
    ],
  },
});

/** The same status code, a DIFFERENT cap: per-minute, back in thirty seconds. */
const PER_MINUTE_QUOTA_429 = JSON.stringify({
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message:
      "Quota exceeded for metric: ...generate_requests_per_model_per_minute",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric:
              "generativelanguage.googleapis.com/generate_requests_per_model_per_minute",
            quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
            quotaValue: "3",
          },
        ],
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "30s",
      },
    ],
  },
});

const SAMPLE_RATE = 24000;
/** Half a second of silence, so the returned WAV has a length to assert. */
const PCM = Buffer.alloc(SAMPLE_RATE);

/**
 * A Cloud TTS success: one flat base64 field, no candidates and no envelope.
 *
 * Raw PCM with NO RIFF header, which is the half of the branch that matters
 * least; `audio200WithRiffHeader` below covers the half that bit us.
 */
const audio200 = (): TtsHttpResponse => ({
  status: 200,
  body: JSON.stringify({ audioContent: PCM.toString("base64") }),
});

/**
 * What Cloud TTS ACTUALLY sends for `LINEAR16`: the PCM behind a 44-byte RIFF
 * header it wrote itself.
 *
 * This is the one real behaviour difference between the two APIs, and it is
 * silent: `pcmToWav` writes its own header, so a response passed through
 * unstripped yields a file whose second header is read as audio — a click,
 * then a run time overstated by 44 bytes on every single line of an Animatic.
 */
const audio200WithRiffHeader = (): TtsHttpResponse => ({
  status: 200,
  body: JSON.stringify({
    audioContent: Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(40), // the rest of a WAV header; contents are irrelevant
      PCM,
    ]).toString("base64"),
  }),
});

// ---------------------------------------------------------------------------
// The fake at the ONE system boundary this module has.
// ---------------------------------------------------------------------------

interface FakeTransport {
  readonly layer: Layer.Layer<GeminiTtsTransport>;
  /** Every chunk actually put on the wire, in order. */
  readonly calls: string[];
}

/**
 * Answers `responses` in order; the LAST answer repeats forever, so a single
 * 429 in the list means "429 until the retries run out".
 */
const fakeTransport = (
  responses: ReadonlyArray<TtsHttpResponse>
): FakeTransport => {
  const calls: string[] = [];
  const layer = Layer.succeed(GeminiTtsTransport, {
    post: (input: { readonly auth: unknown; readonly chunk: string }) =>
      Effect.sync(() => {
        calls.push(input.chunk);
        return responses[Math.min(calls.length - 1, responses.length - 1)]!;
      }),
  } as unknown as GeminiTtsTransport);
  return { layer, calls };
};

const speechWith = (transport: FakeTransport) =>
  ClipMockupSpeechService.DefaultWithoutDependencies.pipe(
    Layer.provide(transport.layer)
  );

const speak = (line: string, transport: FakeTransport) =>
  ClipMockupSpeechService.pipe(
    Effect.flatMap((service) => service.synthesizeLine(line)),
    Effect.provide(speechWith(transport))
  );

describe("the daily quota is a full stop", () => {
  it.effect(
    "a per-day 429 fails at once, without a second call and without sleeping",
    () =>
      Effect.gen(function* () {
        const transport = fakeTransport([
          { status: 429, body: DAILY_QUOTA_429 },
        ]);

        const failure = yield* Effect.flip(
          speak("Here's the problem.", transport)
        );

        // ONE call. The old loop made three, eight seconds apart.
        expect(transport.calls).toEqual(["Here's the problem."]);
        // And not one millisecond of the day was spent waiting for a cap that
        // does not come back for hours.
        expect(yield* Clock.currentTimeMillis).toBe(0);

        expect(failure._tag).toBe("TtsQuotaExhaustedError");
      })
  );

  it.effect("it carries the cap and the moment it comes back", () =>
    Effect.gen(function* () {
      const transport = fakeTransport([{ status: 429, body: DAILY_QUOTA_429 }]);

      const failure = yield* Effect.flip(speak("A line.", transport));
      if (failure._tag !== "TtsQuotaExhaustedError") {
        throw new Error(`expected a quota failure, got ${failure._tag}`);
      }

      expect(failure.quotaValue).toBe("100");
      expect(failure.quotaId).toBe("GenerateRequestsPerDayPerProjectPerModel");
      expect(failure.retryAfterSeconds).toBe(23693);
      // TestClock starts at the epoch, so the reset instant is exact.
      expect(failure.resetsAt).toBe(new Date(23693 * 1000).toISOString());

      // The one line a human reads has to answer "wait, or raise the cap?"
      // on its own — the incident's reset time was legible only inside a raw
      // JSON blob nobody read.
      expect(failure.message).toContain("100");
      expect(failure.message).toContain(failure.resetsAt);
      expect(failure.message).toContain("6h 34m 53s");
    })
  );
});

describe("a transient refusal is retried", () => {
  it.effect("a per-minute 429 is retried, and the line is spoken", () =>
    Effect.gen(function* () {
      const transport = fakeTransport([
        { status: 429, body: PER_MINUTE_QUOTA_429 },
        audio200(),
      ]);

      const fiber = yield* Effect.fork(speak("Say it again.", transport));
      yield* TestClock.adjust("1 minute");
      const spoken = yield* Fiber.join(fiber);

      expect(transport.calls).toEqual(["Say it again.", "Say it again."]);
      expect(spoken.durationSeconds).toBeCloseTo(
        PCM.length / (SAMPLE_RATE * 2),
        6
      );
      expect(spoken.wav.subarray(0, 4).toString()).toBe("RIFF");
    })
  );

  it.effect(
    "it waits the delay THE SERVER asked for, not the computed one",
    () =>
      Effect.gen(function* () {
        const transport = fakeTransport([
          { status: 429, body: PER_MINUTE_QUOTA_429 }, // RetryInfo: 30s
          audio200(),
        ]);

        const fiber = yield* Effect.fork(speak("Wait for it.", transport));

        // The computed backoff would have come back after about a second. It
        // must not: the server said thirty.
        yield* TestClock.adjust("29 seconds");
        expect(transport.calls).toHaveLength(1);

        yield* TestClock.adjust("2 seconds");
        yield* Fiber.join(fiber);
        expect(transport.calls).toHaveLength(2);
      })
  );

  it.effect("the retries are bounded, and the give-up keeps the old tag", () =>
    Effect.gen(function* () {
      const transport = fakeTransport([
        { status: 503, body: "upstream is having a day" },
      ]);

      const fiber = yield* Effect.fork(
        Effect.flip(speak("Doomed.", transport))
      );
      yield* TestClock.adjust("10 minutes");
      const failure = yield* Fiber.join(fiber);

      // Four attempts: the first, plus TTS_MAX_RETRIES.
      expect(transport.calls).toHaveLength(4);
      // The contract `cvm clip-mockup` documents — exit 4 — is unchanged for
      // everything that is not the daily cap.
      expect(failure._tag).toBe("SpeechSynthesisError");
      expect(failure.message).toContain("503");
    })
  );

  it.effect("a 400 is not transient and is not retried", () =>
    Effect.gen(function* () {
      const transport = fakeTransport([
        { status: 400, body: '{"error":{"message":"bad request"}}' },
      ]);

      const failure = yield* Effect.flip(speak("Malformed.", transport));

      expect(transport.calls).toHaveLength(1);
      expect(failure._tag).toBe("SpeechSynthesisError");
    })
  );
});

// ---------------------------------------------------------------------------
// The cache, through its real caller — no TestClock, a real temp directory.
// ---------------------------------------------------------------------------

describe("the speech cache costs no request", () => {
  const LINEAGE = "lineage-cache-test";
  let dir: string;
  let previousDir: string | undefined;

  beforeAll(() => {
    previousDir = process.env[CLIP_MOCKUP_DIR_ENV_KEY];
    dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-speech-cache-"));
    process.env[CLIP_MOCKUP_DIR_ENV_KEY] = dir;
  });

  afterAll(() => {
    nodeFs.rmSync(dir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env[CLIP_MOCKUP_DIR_ENV_KEY];
    else process.env[CLIP_MOCKUP_DIR_ENV_KEY] = previousDir;
  });

  beforeEach(() => {
    nodeFs.rmSync(nodePath.join(dir, LINEAGE), {
      recursive: true,
      force: true,
    });
  });

  it("the same line twice puts ONE request on the wire", async () => {
    const transport = fakeTransport([audio200()]);
    const resolve = () =>
      Effect.runPromise(
        resolveClipMockupSpeech({
          lineageId: LINEAGE,
          line: "Here's the problem.",
        }).pipe(
          Effect.provide(speechWith(transport)),
          Effect.provide(NodeContext.layer)
        )
      );

    const first = await resolve();
    const second = await resolve();

    expect(transport.calls).toEqual(["Here's the problem."]);
    expect(second.audioPath).toBe(first.audioPath);
    expect(second.audioPath).toBe(speechFilename("Here's the problem."));
    // The duration still arrives, read straight back out of the WAV header.
    expect(second.durationSeconds).toBeCloseTo(first.durationSeconds, 6);
  });
});

// ===========================================================================
// The shape of a Cloud TTS success.
//
// Moving off the Gemini API changed exactly one thing about a 200: the audio
// arrives as a flat `audioContent` string, and for LINEAR16 it comes with a
// RIFF header already on it. `pcmToWav` writes its own, so the header has to
// come off first — and getting that wrong is SILENT, which is why it is
// asserted here rather than left to a listen-through.
// ===========================================================================

describe("a 200 carries base64 audio", () => {
  it.effect("a RIFF header from Cloud TTS is stripped, not doubled", () =>
    Effect.gen(function* () {
      const withHeader = fakeTransport([audio200WithRiffHeader()]);
      const withoutHeader = fakeTransport([audio200()]);

      const a = yield* speak("A line.", withHeader);
      const b = yield* speak("A line.", withoutHeader);

      // Same audio either way: the 44 bytes Cloud TTS prepended are gone.
      expect(a.wav.byteLength).toBe(b.wav.byteLength);
      expect(a.durationSeconds).toBeCloseTo(b.durationSeconds, 9);
      // And the result is ONE well-formed WAV, not a header wrapping a header.
      expect(Buffer.from(a.wav).subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(Buffer.from(a.wav).subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(Buffer.from(a.wav).subarray(36, 40).toString("ascii")).toBe(
        "data"
      );
      // Half a second of s16le mono at 24kHz, and not a byte more.
      expect(a.durationSeconds).toBeCloseTo(PCM.length / (SAMPLE_RATE * 2), 9);
    })
  );

  it.effect("a 200 with no audioContent is a failure, not a silent WAV", () =>
    Effect.gen(function* () {
      const transport = fakeTransport([{ status: 200, body: "{}" }]);

      const failure = yield* Effect.flip(speak("A line.", transport));

      expect(failure._tag).toBe("SpeechSynthesisError");
      expect(failure.message).toContain("no audioContent");
    })
  );
});
