import { Effect } from "effect";
import { createHash } from "node:crypto";
import {
  CLIP_MOCKUP_TTS_MODEL,
  CLIP_MOCKUP_VOICE,
  DEFAULT_SAMPLE_RATE,
  loadKokoro,
  SpeechSynthesisError,
  wordCount,
  type KokoroVoice,
} from "./clip-mockup-speech-kokoro";

/**
 * The one voice, the one model and the one typed failure are re-exported here
 * so this file stays the single import site: the split into
 * `clip-mockup-speech-kokoro.ts` keeps the engine in one place, it is not an
 * interface.
 */
export {
  CLIP_MOCKUP_TTS_MODEL,
  CLIP_MOCKUP_VOICE,
  CUDA_INSTALL_COMMAND,
  float32ToPcm16,
  SpeechSynthesisError,
} from "./clip-mockup-speech-kokoro";

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
 * ONE ENTRY POINT: `synthesizeLine`. Everything about the engine — loading
 * Kokoro onto the GPU, the sample format it speaks in — lives in
 * `clip-mockup-speech-kokoro.ts` and is invisible from out here.
 *
 * NOT A TESTED SEAM. Nothing in the CVM test suite may load a model onto a
 * GPU, so every command that speaks a line branches on
 * `Effect.serviceOption` first and the suites hand it a `Layer.succeed` fake.
 * This module is the thing that is faked, never the thing under test.
 *
 * It lives in `apps/local` because the WAV it produces is written to a disk,
 * and `@cvm/core` is deployed to a box that has none.
 */

/**
 * Kokoro reads at most 512 phoneme tokens in one pass and SILENTLY cuts off
 * the rest, so a line is voiced in pieces and the raw PCM spliced back
 * together. Fifty words is about 300 tokens: room for long technical words.
 * A Clip Mockup line is normally one sentence and never reaches this.
 */
const CHUNK_WORD_BUDGET = 50;

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
 * Read the run time straight back out of a WAV's header, so a cache hit
 * loads no model and still yields the duration the row needs.
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

/** Cut one over-budget sentence between words, into pieces under budget. */
function splitBetweenWords(sentence: string, wordBudget: number): string[] {
  const words = sentence.trim().split(/\s+/);
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += wordBudget) {
    pieces.push(words.slice(i, i + wordBudget).join(" "));
  }
  return pieces;
}

/**
 * Split a long line into chunks under `wordBudget`, splitting between
 * sentences wherever it can. A single sentence over budget is cut between
 * WORDS instead — an odd pause beats the silent truncation Kokoro would
 * otherwise apply. The line is never dropped or truncated.
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
    if (w > wordBudget) {
      chunks.push(...splitBetweenWords(sentence, wordBudget));
      continue;
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
const speak = (line: string, voice: KokoroVoice) =>
  Effect.gen(function* () {
    const chunks = chunkLine(line, CHUNK_WORD_BUDGET);
    const pieces: Buffer[] = [];
    let rate: number | undefined;
    for (const [i, chunk] of chunks.entries()) {
      const { pcm, rate: chunkRate } = yield* voice.speakChunk(chunk);
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
    /**
     * Building the layer IS loading the model: ~1.4s on the GPU. Only the
     * Clip Mockup daemon builds it, once for its whole life, and only when
     * the first line that is not already on disk arrives — so a `cvm` process
     * never loads Kokoro, and a line already spoken never loads it at all.
     *
     * No credential, no config and no `.env`: the model runs in the daemon's
     * process and needs nothing the repo could forget to set.
     */
    effect: Effect.gen(function* () {
      const voice = yield* loadKokoro;

      /**
       * A line in, a WAV and its measured length out. One way out:
       * `SpeechSynthesisError`, the tag `cvm clip-mockup` has always
       * documented (exit 4).
       */
      const synthesizeLine = Effect.fn("synthesizeLine")(function* (
        line: string
      ) {
        return yield* speak(line, voice);
      });

      return { synthesizeLine };
    }),
  }
) {}
