import { Data, Effect } from "effect";
import { createHash } from "node:crypto";

/**
 * The voice of a Clip Mockup's line.
 *
 * A Clip Mockup carries one spoken line and nothing else, so this service
 * turns a line into a WAV and the number of seconds it runs. That number is
 * the whole point: summed across a Video's Animatic it says a Lesson runs 34
 * minutes before anybody presses play.
 *
 * ONE VOICE, ONE MODEL, BOTH CONSTANTS. Every line is the author's own, so a
 * second voice would invent a character who will not exist in the filmed
 * video. They are named constants rather than per-call arguments on purpose:
 * the voice is part of what a stored WAV IS, and a caller that could pass a
 * different one would make the cache below lie.
 *
 * Copied in shape from `personal-wiki/src/briefing/render.ts` — plain `fetch`,
 * no SDK, raw `audio/L16;rate=24000` PCM wrapped in a hand-built WAV header.
 * Its multi-speaker half is deliberately NOT here.
 *
 * NOT A TESTED SEAM. Nothing in the CVM test suite may reach Gemini, so every
 * command that speaks a line branches on `Effect.serviceOption` first and the
 * suites hand it a `Layer.succeed` fake. This module is the thing that is
 * faked, never the thing under test.
 *
 * It lives in `apps/local` because the WAV it produces is written to a disk,
 * and `@cvm/core` is deployed to a box that has none.
 */

/** The single Gemini prebuilt voice every Clip Mockup line is read in. */
export const CLIP_MOCKUP_VOICE = "Leda";

/** The single Gemini TTS model every Clip Mockup line is read by. */
export const CLIP_MOCKUP_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** The environment variable holding the Gemini key. */
export const GEMINI_API_KEY_ENV_KEY = "GEMINI_API_KEY";

/**
 * A single Gemini TTS call caps out around the 32k-token session window, so a
 * very long line is voiced in pieces and the raw PCM spliced back together.
 * A Clip Mockup line is normally one sentence and never reaches this; it is a
 * safety net so a wordy line degrades instead of truncating mid-word.
 */
const CHUNK_WORD_BUDGET = 800;

/** Silence inserted between spliced chunks (ms) — a breath that hides the seam. */
const CHUNK_GAP_MS = 250;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const DEFAULT_SAMPLE_RATE = 24000;

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

/** A voiced line: the WAV bytes and how long they run. */
export interface SpokenLine {
  readonly wav: Uint8Array;
  /** Seconds, as a FLOAT — never rounded. See `durationSeconds` on the row. */
  readonly durationSeconds: number;
}

/**
 * The filename a line's speech is stored under, inside the Video's own Clip
 * Mockup directory.
 *
 * Addressed by a hash of the LINE, the VOICE and the MODEL — the three things
 * that decide what the audio sounds like — so adding the same line twice
 * writes one file and speaks it once. Changing any of the three is a different
 * file, which is what makes a stale WAV impossible rather than merely
 * unlikely.
 */
export function speechFilename(line: string): string {
  const hash = createHash("sha256")
    .update(`${CLIP_MOCKUP_TTS_MODEL}\n${CLIP_MOCKUP_VOICE}\n${line}`)
    .digest("hex");
  return `speech-${hash.slice(0, 32)}.wav`;
}

/**
 * Read the run time straight back out of a WAV's header, so a cache hit costs
 * no Gemini call and still yields the duration the row needs.
 *
 * `undefined` for anything this cannot read: the caller treats that as a cache
 * MISS and re-synthesises, so a truncated or foreign file heals itself instead
 * of poisoning a run-time estimate.
 */
export function wavDurationSeconds(wav: Uint8Array): number | undefined {
  if (wav.byteLength < 44) return undefined;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...wav.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(36) !== "data") {
    return undefined;
  }
  const byteRate = view.getUint32(28, true);
  const dataSize = view.getUint32(40, true);
  if (byteRate === 0 || dataSize === 0) return undefined;
  return dataSize / byteRate;
}

/** Wrap raw little-endian PCM (s16le mono) in a minimal WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  // Offset 34 is bitsPerSample, and it is NOT optional. Left at zero the
  // header still parses: ffprobe reads the duration straight off byteRate and
  // reports the file as 8.97s of audio, so every check this repo made passed.
  // A browser will not decode it — `<Audio>` in the Animatic played silence.
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** N milliseconds of s16le mono silence at the given sample rate. */
function silencePcm(ms: number, sampleRate: number): Buffer {
  const samples = Math.round((sampleRate * ms) / 1000);
  return Buffer.alloc(samples * 2); // 16-bit => 2 bytes/sample
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * Split a long line into chunks under `wordBudget`, never splitting a
 * sentence. A single sentence over budget still becomes its own chunk — the
 * line is never dropped or truncated.
 */
export function chunkLine(line: string, wordBudget: number): string[] {
  const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
  const chunks: string[] = [];
  let current = "";
  let words = 0;
  for (const sentence of sentences) {
    const w = wordCount(sentence);
    if (current !== "" && words + w > wordBudget) {
      chunks.push(current.trim());
      current = "";
      words = 0;
    }
    current += sentence;
    words += w;
  }
  if (current.trim() !== "") chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [line];
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Voice one chunk, retrying transient failures (429/5xx) with exponential
 * backoff and giving up immediately on a 4xx.
 */
async function synthesizeChunk(
  chunk: string,
  apiKey: string
): Promise<{ pcm: Buffer; rate: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CLIP_MOCKUP_TTS_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: chunk }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: CLIP_MOCKUP_VOICE },
              },
            },
          },
        }),
      }
    );
    if (res.ok) {
      const json = (await res.json()) as GeminiTtsResponse;
      const inline = json.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData
      )?.inlineData;
      if (!inline) throw new Error(describeMissingAudio(json, chunk));
      // mimeType looks like "audio/L16;rate=24000".
      const rate = Number(
        inline.mimeType.match(/rate=(\d+)/)?.[1] ?? DEFAULT_SAMPLE_RATE
      );
      return { pcm: Buffer.from(inline.data, "base64"), rate };
    }
    const bodyText = await res.text();
    lastErr = new Error(`Gemini TTS ${res.status}: ${bodyText}`);
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) {
      throw lastErr;
    }
    await sleep(1000 * 2 ** (attempt - 1));
  }
  throw lastErr; // unreachable, but keeps the type checker happy
}

/** Speak a whole line, splicing the chunks back together. */
async function speak(line: string, apiKey: string): Promise<SpokenLine> {
  const chunks = chunkLine(line, CHUNK_WORD_BUDGET);
  const pieces: Buffer[] = [];
  let rate: number | undefined;
  for (const [i, chunk] of chunks.entries()) {
    const { pcm, rate: chunkRate } = await synthesizeChunk(chunk, apiKey);
    if (rate === undefined) rate = chunkRate;
    else if (chunkRate !== rate) {
      throw new Error(
        `Sample-rate mismatch across chunks (${rate} vs ${chunkRate}) — cannot splice.`
      );
    }
    if (i > 0 && CHUNK_GAP_MS > 0) pieces.push(silencePcm(CHUNK_GAP_MS, rate));
    pieces.push(pcm);
  }

  const pcm = Buffer.concat(pieces);
  const finalRate = rate ?? DEFAULT_SAMPLE_RATE;
  return {
    wav: pcmToWav(pcm, finalRate),
    // s16le mono => 2 bytes per sample. A FLOAT, deliberately: the source
    // adapter rounded to whole seconds, which across sixty Clip Mockups
    // drifts an Animatic's run-time estimate by minutes.
    durationSeconds: pcm.length / (finalRate * 2),
  };
}

export class ClipMockupSpeechService extends Effect.Service<ClipMockupSpeechService>()(
  "ClipMockupSpeechService",
  {
    effect: Effect.gen(function* () {
      /**
       * A line in, a WAV and its measured length out.
       *
       * The key is read HERE, at call time, not while this layer is being
       * built. `Effect.provide` builds a layer before the effect inside it
       * runs, so a key read at build time is read before the CLI has loaded
       * the repo `.env` — the bug commit 2205d419 fixed for
       * `footage transcribe`.
       */
      const synthesizeLine = Effect.fn("synthesizeLine")(function* (
        line: string
      ) {
        const apiKey = process.env[GEMINI_API_KEY_ENV_KEY];
        if (!apiKey) {
          return yield* new SpeechSynthesisError({
            cause: null,
            message: `${GEMINI_API_KEY_ENV_KEY} is not set — cannot speak a Clip Mockup line.`,
          });
        }
        return yield* Effect.tryPromise({
          try: () => speak(line, apiKey),
          catch: (cause) =>
            new SpeechSynthesisError({
              cause,
              message:
                cause instanceof Error
                  ? cause.message
                  : `Failed to synthesise speech: ${String(cause)}`,
            }),
        });
      });

      return { synthesizeLine };
    }),
  }
) {}
