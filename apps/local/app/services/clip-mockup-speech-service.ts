import { Effect, RateLimiter } from "effect";
import { createHash } from "node:crypto";
import {
  CLIP_MOCKUP_TTS_MODEL,
  CLIP_MOCKUP_VOICE,
  DEFAULT_SAMPLE_RATE,
  GEMINI_API_KEY_ENV_KEY,
  GeminiTtsTransport,
  SpeechSynthesisError,
  synthesizeChunk,
  TTS_MAX_RETRIES,
  TTS_RATE_INTERVAL,
  TTS_REQUESTS_PER_INTERVAL,
  wordCount,
  type TtsCaller,
} from "./clip-mockup-speech-gemini";

/**
 * The one voice, the one model, the two typed failures and the HTTP seam are
 * re-exported here so this file stays the single import site: the split into
 * `clip-mockup-speech-gemini.ts` is a token-budget fact, not an interface.
 */
export {
  CLIP_MOCKUP_TTS_MODEL,
  CLIP_MOCKUP_VOICE,
  GEMINI_API_KEY_ENV_KEY,
  GeminiTtsTransport,
  SpeechSynthesisError,
  TtsQuotaExhaustedError,
  TtsTransientError,
  type TtsHttpResponse,
} from "./clip-mockup-speech-gemini";

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
 * ONE ENTRY POINT: `synthesizeLine`. Everything about how Gemini is actually
 * asked — the pacing, the backoff, the reading of a 429 body, the two typed
 * failures — lives in `clip-mockup-speech-gemini.ts` and is invisible from
 * out here. A caller chooses none of it, which is what keeps the policy from
 * drifting between `cvm clip-mockup add` and the video editor.
 *
 * NOT A TESTED SEAM. Nothing in the CVM test suite may reach Gemini, so every
 * command that speaks a line branches on `Effect.serviceOption` first and the
 * suites hand it a `Layer.succeed` fake. This module is the thing that is
 * faked, never the thing under test.
 *
 * It lives in `apps/local` because the WAV it produces is written to a disk,
 * and `@cvm/core` is deployed to a box that has none.
 */

/**
 * A single Gemini TTS call caps out around the 32k-token session window, so a
 * very long line is voiced in pieces and the raw PCM spliced back together.
 * A Clip Mockup line is normally one sentence and never reaches this; it is a
 * safety net so a wordy line degrades instead of truncating mid-word.
 */
const CHUNK_WORD_BUDGET = 800;

/** Silence inserted between spliced chunks (ms) — a breath that hides the seam. */
const CHUNK_GAP_MS = 250;

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

/**
 * Speak a whole line, splicing the chunks back together.
 *
 * Still a `for` loop, deliberately. A `Stream` would buy concurrency this walk
 * must not have (the chunks are spliced IN ORDER and share one sample rate)
 * and would hide the running `rate` check behind a fold, so it reads worse
 * than the six lines it replaces. The splice gap, the sample-rate check and
 * the WAV header are byte-for-byte what they were.
 */
const speak = (line: string, caller: TtsCaller) =>
  Effect.gen(function* () {
    const chunks = chunkLine(line, CHUNK_WORD_BUDGET);
    const pieces: Buffer[] = [];
    let rate: number | undefined;
    for (const [i, chunk] of chunks.entries()) {
      const { pcm, rate: chunkRate } = yield* synthesizeChunk(chunk, caller);
      if (rate === undefined) rate = chunkRate;
      else if (chunkRate !== rate) {
        return yield* new SpeechSynthesisError({
          cause: null,
          message: `Sample-rate mismatch across chunks (${rate} vs ${chunkRate}) — cannot splice.`,
        });
      }
      if (i > 0 && CHUNK_GAP_MS > 0)
        pieces.push(silencePcm(CHUNK_GAP_MS, rate));
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
    } satisfies SpokenLine;
  });

export class ClipMockupSpeechService extends Effect.Service<ClipMockupSpeechService>()(
  "ClipMockupSpeechService",
  {
    dependencies: [GeminiTtsTransport.Default],
    // `scoped`, not `effect`, because the RateLimiter owns a fiber and must be
    // released with the layer.
    scoped: Effect.gen(function* () {
      const transport = yield* GeminiTtsTransport;
      const limit = yield* RateLimiter.make({
        limit: TTS_REQUESTS_PER_INTERVAL,
        interval: TTS_RATE_INTERVAL,
        algorithm: "fixed-window",
      });

      /**
       * A line in, a WAV and its measured length out.
       *
       * ONE METHOD, and the pacing and the backoff are invisible from here:
       * a caller decides nothing about either, which is what stops the policy
       * drifting between `clip-mockup add` and the editor.
       *
       * Two ways out. `TtsQuotaExhaustedError` escapes UNTOUCHED, because the
       * daily cap is a fact the human has to act on; everything else arrives
       * as `SpeechSynthesisError`, the tag `cvm clip-mockup` has always
       * documented, so nothing downstream had to change to keep working.
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
        return yield* speak(line, { transport, limit, apiKey }).pipe(
          Effect.catchTag(
            "TtsTransientError",
            (failure) =>
              new SpeechSynthesisError({
                cause: failure.cause,
                message: `${failure.message} (gave up after ${
                  TTS_MAX_RETRIES + 1
                } attempts)`,
              })
          )
        );
      });

      return { synthesizeLine };
    }),
  }
) {}
