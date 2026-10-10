import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { Config, Duration, Effect, Fiber, Layer } from "effect";
import {
  LocalWhisperEngine,
  LocalWhisperError,
  type AudioTranscript,
} from "@/services/local-whisper-engine";
import {
  ensureWhisperEnv,
  ensureWhisperModel,
  WHISPER_MODELS_DIR,
  WORKER_SCRIPT,
} from "./local-whisper-env";

/**
 * The live **Local Whisper** engine, the Sidecar's only way to transcribe:
 * one Python worker (`local-whisper/worker.py`, faster-whisper) that the
 * Sidecar starts on the first transcription and keeps alive, so the model
 * stays loaded in VRAM and a Clip costs ~0.5 s. The worker answers one file
 * at a time; requests queue in order. After {@link IDLE_MINUTES} with nothing
 * to do it is stopped, handing its VRAM back to the exports' NVENC, and the
 * next transcription starts it again (~2 s, once).
 *
 * When the Sidecar starts it makes the worker's Python env and model ready in
 * the background (`local-whisper-env.ts`); a transcription waits for that.
 * Nothing falls back: if the env could not be built or the GPU will not load
 * the model, the transcription fails with a message naming the fix, and the
 * Job fails as any Job does.
 */

export const WHISPER_MODEL = "large-v3-turbo";
/** The batched pipeline: fastest on both Clips and long Footage. */
const BATCHED = true;
export const IDLE_MINUTES = 10;

/**
 * CTranslate2's compute type: `float16` (fastest, ~2.2 GB of VRAM) or
 * `int8_float16` (~1.2 GB, about as fast). The one tunable.
 */
const computeTypeConfig = Config.string("CVM_WHISPER_COMPUTE_TYPE").pipe(
  Config.withDefault("float16")
);

/** A footage chunk is ~27 minutes of audio; turbo hears that in ~15 s. */
const REQUEST_TIMEOUT = Duration.minutes(5);

export interface WorkerConfig {
  /** The program and arguments that start a worker speaking the protocol. */
  readonly command: string;
  readonly args: readonly string[];
  readonly idleMs: number;
  /** For the error when the model will not load. */
  readonly model: string;
}

type Pending = {
  resolve: (t: AudioTranscript) => void;
  reject: (e: Error) => void;
};

const gpuFix = (model: string, detail: string) =>
  `Local Whisper could not load ${model} on the GPU: ${detail}\nFix: check \`nvidia-smi\` works in the Sidecar's shell (on WSL that needs the Windows NVIDIA driver) and that ~2.5 GB of VRAM is free, then transcribe again.`;

/** The worker process, started on demand and stopped when idle. */
export const makeWorker = (config: WorkerConfig) => {
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  const pending = new Map<string, Pending>();

  const failAll = (error: Error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };

  const stop = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    child?.kill("SIGTERM");
    child = null;
    ready = null;
  };

  const start = (): Promise<void> => {
    const proc = spawn(config.command, [...config.args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = proc;
    let stderrTail = "";
    let fatal: string | null = null;
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    return new Promise<void>((resolve, reject) => {
      readline.createInterface({ input: proc.stdout }).on("line", (line) => {
        let message: {
          ready?: boolean;
          fatal?: string;
          id?: string;
          error?: string;
        } & Partial<AudioTranscript>;
        try {
          message = JSON.parse(line);
        } catch {
          return; // a stray print from a library, not the protocol
        }
        if (message.ready) return resolve();
        if (message.fatal) {
          fatal = message.fatal;
          return;
        }
        const p = message.id ? pending.get(message.id) : undefined;
        if (!p || !message.id) return;
        pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error));
        else
          p.resolve({
            segments: message.segments ?? [],
            words: message.words ?? [],
          });
      });
      const onGone = (reason: string) => {
        const error = new Error(
          fatal
            ? gpuFix(config.model, fatal)
            : `${reason}\n${stderrTail.trim()}`
        );
        if (child === proc) {
          child = null;
          ready = null;
        }
        reject(error);
        failAll(error);
      };
      proc.on("error", (e) =>
        onGone(`The Local Whisper worker would not start: ${e}`)
      );
      proc.on("exit", (code, signal) =>
        onGone(
          `The Local Whisper worker exited (code ${code}, signal ${signal})`
        )
      );
    });
  };

  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (pending.size === 0) stop();
    }, config.idleMs);
    idleTimer.unref();
  };

  const transcribe = async (audioPath: string): Promise<AudioTranscript> => {
    if (idleTimer) clearTimeout(idleTimer);
    const id = String(++nextId);
    const result = new Promise<AudioTranscript>((resolve, reject) =>
      pending.set(id, { resolve, reject })
    );
    // When the worker dies before it is ready, `ready` is what this call
    // throws; this keeps the same failure on `result` from going unhandled.
    result.catch(() => {});
    try {
      ready ??= start();
      await ready;
      child?.stdin.write(JSON.stringify({ id, audio: audioPath }) + "\n");
      return await result;
    } finally {
      pending.delete(id);
      if (pending.size === 0) armIdleTimer();
    }
  };

  return {
    transcribe,
    stop,
    /** Whether a worker process is running (the model is loaded or loading). */
    isRunning: () => child !== null,
  };
};

/**
 * The live engine: the env and model made ready in the background from the
 * moment the Sidecar starts, then one worker for the Sidecar's life.
 */
export const LocalWhisperEngineLive = Layer.scoped(
  LocalWhisperEngine,
  Effect.gen(function* () {
    const computeType = yield* computeTypeConfig;

    const prepared = yield* Effect.forkScoped(
      Effect.gen(function* () {
        const python = yield* ensureWhisperEnv;
        yield* ensureWhisperModel(python, WHISPER_MODEL);
        return python;
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError(
            `Local Whisper is unavailable; transcription Jobs will fail. ${error.message}`
          )
        )
      )
    );

    let worker: ReturnType<typeof makeWorker> | null = null;
    yield* Effect.addFinalizer(() => Effect.sync(() => worker?.stop()));

    yield* Effect.logInfo("Local Whisper: engine configured", {
      model: WHISPER_MODEL,
      computeType,
      batched: BATCHED,
      idleMinutes: IDLE_MINUTES,
    });

    return {
      transcribe: (audioPath: string) =>
        Effect.gen(function* () {
          const python = yield* Fiber.join(prepared);
          worker ??= makeWorker({
            command: python,
            args: [
              "-I",
              WORKER_SCRIPT,
              WHISPER_MODEL,
              computeType,
              BATCHED ? "1" : "0",
              WHISPER_MODELS_DIR,
            ],
            idleMs: IDLE_MINUTES * 60_000,
            model: WHISPER_MODEL,
          });
          const w = worker;
          return yield* Effect.tryPromise({
            try: () => w.transcribe(audioPath),
            catch: (cause) =>
              new LocalWhisperError({
                cause,
                message: `Local Whisper failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              }),
          }).pipe(
            // The env build above may take minutes on a first start; only
            // the worker's own answer is timed.
            Effect.timeoutFail({
              duration: REQUEST_TIMEOUT,
              onTimeout: () =>
                new LocalWhisperError({
                  cause: null,
                  message: `Local Whisper took longer than ${Duration.format(REQUEST_TIMEOUT)} on one file`,
                }),
            })
          );
        }),
    };
  })
);
