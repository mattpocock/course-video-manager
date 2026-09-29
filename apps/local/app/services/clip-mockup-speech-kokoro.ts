import {
  AutoTokenizer,
  env as transformersEnv,
  StyleTextToSpeech2Model,
} from "@huggingface/transformers";
import { Data, Effect } from "effect";
import { KokoroTTS } from "kokoro-js";
import os from "node:os";
import nodePath from "node:path";

/**
 * THE PRIVATE LOWER HALF OF `clip-mockup-speech-service.ts` — everything that
 * knows Kokoro exists.
 *
 * Import the SERVICE, not this: `ClipMockupSpeechService.synthesizeLine` is
 * the one entry point. This file is its own module so the engine can be read
 * in one place; the public names it declares are re-exported from the
 * service.
 *
 * What lives here: the ONE voice and the ONE model, loading that model onto
 * the GPU, and turning one chunk of a line into raw PCM.
 *
 * WHY A LOCAL MODEL. An Animatic is scratch audio for a rough cut, not a
 * voice-over. Cloud TTS cost money per line, paced every call behind a rate
 * limiter, and had already stopped one authoring run dead on a daily quota.
 * Kokoro-82M runs in THIS process on the author's own GPU at ~30x real time,
 * with no key, no quota and no network after the first download. That is
 * possible only because every `cvm clip-mockup` verb is Local-only: speech is
 * never made on a box without the author's GPU.
 */

/** The single Kokoro voice every Clip Mockup line is read in. */
export const CLIP_MOCKUP_VOICE = "af_heart";

/**
 * The single model every Clip Mockup line is read by, as its Hugging Face id.
 *
 * It is part of the speech cache key in `speechFilename`, so changing this
 * string retires every WAV already on disk — which is correct, and is why it
 * is stated here and nowhere else. The dtype below is NOT in the key: it is a
 * constant of this file, and a change to it must change this string too.
 */
export const CLIP_MOCKUP_TTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * fp32, not a quantised build. Measured on the author's machine: q8 ran ~3x
 * SLOWER on the CPU than fp32, and fp16 on the GPU was barely faster than
 * fp32 but took five times as long to load — and every `cvm` call loads it.
 */
const KOKORO_DTYPE = "fp32";

/** Kokoro always speaks at 24kHz. */
export const DEFAULT_SAMPLE_RATE = 24000;

/**
 * Where the ~330MB model is kept after its first download.
 *
 * Outside the repo on purpose. transformers.js caches inside its own package
 * directory by default, which is a different directory in every worktree and
 * is emptied by every reinstall — so each fresh checkout would download the
 * model again before it could voice one line.
 */
const KOKORO_CACHE_DIR = nodePath.join(os.homedir(), ".cache", "cvm", "kokoro");

/**
 * The one thing on this machine the GPU path needs that `pnpm install` cannot
 * provide: the CUDA 12 runtime libraries onnxruntime-node links against. No
 * driver and no toolkit — WSL supplies the driver from Windows, and a Linux
 * driver package would break it.
 */
export const CUDA_INSTALL_COMMAND =
  "wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb && " +
  "sudo dpkg -i cuda-keyring_1.1-1_all.deb && sudo apt-get update && " +
  "sudo apt-get install -y --no-install-recommends cuda-cudart-12-9 cuda-nvrtc-12-9 " +
  "libcublas-12-9 libcufft-12-9 libcurand-12-9 libcudnn9-cuda-12 && sudo ldconfig";

/**
 * The one way speech fails. `cvm clip-mockup` has always documented this tag
 * (exit 4), so nothing downstream had to change when the engine did.
 */
export class SpeechSynthesisError extends Data.TaggedError(
  "SpeechSynthesisError"
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

/** Words in a string — the chunker's budget is counted in them. */
export const wordCount = (s: string) =>
  s.trim() ? s.trim().split(/\s+/).length : 0;

/**
 * Kokoro's float samples as s16le PCM, which is what `pcmToWav` wraps and
 * what every WAV already on disk holds. Clamped, because a float sample can
 * overshoot [-1, 1] and must not wrap around to the opposite sign.
 */
export function float32ToPcm16(samples: Float32Array): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (const [i, sample] of samples.entries()) {
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm.writeInt16LE(Math.round(clamped * 0x7fff), i * 2);
  }
  return pcm;
}

/** A loaded model, ready to read chunks aloud. */
export interface KokoroVoice {
  readonly speakChunk: (
    chunk: string
  ) => Effect.Effect<{ pcm: Buffer; rate: number }, SpeechSynthesisError>;
}

const describe = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Load Kokoro onto the GPU. ~1.4s once the model is cached; the first run on
 * a machine downloads it.
 *
 * Built from its two halves rather than through `KokoroTTS.from_pretrained`,
 * which does exactly this but types `device` without "cuda" even though it
 * passes the value straight through. Building it here keeps the one real
 * choice — the GPU — visible and checked.
 *
 * GPU ONLY, deliberately: there is no CPU fallback. A missing CUDA library
 * fails the line with the install command in the message, rather than quietly
 * voicing it ten times slower.
 */
export const loadKokoro: Effect.Effect<KokoroVoice, SpeechSynthesisError> =
  Effect.tryPromise({
    try: async () => {
      transformersEnv.cacheDir = KOKORO_CACHE_DIR;
      // Errors only, in both of onnxruntime's loggers (the process-wide one
      // and the session's). It warns on every load and every first run, and
      // it warns on STDERR — where `cvm` writes its error JSON for an agent
      // to parse.
      transformersEnv.backends.onnx.logLevel = "error";
      const [model, tokenizer] = await Promise.all([
        StyleTextToSpeech2Model.from_pretrained(CLIP_MOCKUP_TTS_MODEL, {
          dtype: KOKORO_DTYPE,
          device: "cuda",
          session_options: { logSeverityLevel: 3 },
        }),
        AutoTokenizer.from_pretrained(CLIP_MOCKUP_TTS_MODEL),
      ]);
      return new KokoroTTS(model, tokenizer);
    },
    catch: (cause) =>
      new SpeechSynthesisError({
        cause,
        message:
          `Kokoro could not load on the GPU: ${describe(cause)}. ` +
          `If a CUDA library is missing, install the CUDA 12 runtime once: ${CUDA_INSTALL_COMMAND}`,
      }),
  }).pipe(
    Effect.map((tts): KokoroVoice => ({
      speakChunk: (chunk) =>
        Effect.tryPromise({
          try: () => tts.generate(chunk, { voice: CLIP_MOCKUP_VOICE }),
          catch: (cause) =>
            new SpeechSynthesisError({
              cause,
              message: `Kokoro could not voice a ${wordCount(chunk)}-word chunk: ${describe(cause)}`,
            }),
        }).pipe(
          Effect.map((audio) => ({
            pcm: float32ToPcm16(audio.audio),
            rate: audio.sampling_rate,
          }))
        ),
    }))
  );
