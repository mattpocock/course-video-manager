import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { Config, Duration, Effect, Layer, Option } from "effect";
import {
  LocalWhisperDisabled,
  LocalWhisperEngine,
  LocalWhisperError,
  type AudioTranscript,
} from "@/services/local-whisper-engine";

/**
 * The live **Local Whisper** engine: one Python worker
 * (`local-whisper/worker.py`, faster-whisper) that the Sidecar starts on the
 * first transcription and keeps alive, so the model stays loaded in VRAM and
 * a Clip costs ~0.5 s instead of OpenAI's ~2 s round trip. The worker
 * answers one file at a time; requests queue in order. After
 * `CVM_WHISPER_IDLE_MINUTES` with nothing to do it is stopped, handing its
 * VRAM back to the exports' NVENC, and the next transcription starts it again
 * (~2 s, once).
 *
 * Config, read when the Sidecar starts:
 * - `CVM_WHISPER_ENGINE`: `openai` (default) or `local`.
 * - `CVM_WHISPER_PYTHON`: a Python with `faster-whisper` installed
 *   (required when local).
 * - `CVM_WHISPER_MODEL` (`large-v3-turbo`), `CVM_WHISPER_COMPUTE_TYPE`
 *   (`float16`), `CVM_WHISPER_BATCHED` (`true`), `CVM_WHISPER_MODELS_DIR`
 *   (faster-whisper's own cache when unset), `CVM_WHISPER_IDLE_MINUTES` (10).
 */

const WORKER_SCRIPT = path.join(
  import.meta.dirname,
  "local-whisper",
  "worker.py"
);

/** A footage chunk is ~27 minutes of audio; turbo hears that in ~15 s. */
const REQUEST_TIMEOUT = Duration.minutes(5);

interface WorkerConfig {
  readonly python: string;
  readonly model: string;
  readonly computeType: string;
  readonly batched: boolean;
  readonly modelsDir: string;
  readonly idleMs: number;
}

type Pending = {
  resolve: (t: AudioTranscript) => void;
  reject: (e: Error) => void;
};

/** The worker process, started on demand and stopped when idle. */
const makeWorker = (config: WorkerConfig) => {
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
    const proc = spawn(
      config.python,
      [
        "-I",
        WORKER_SCRIPT,
        config.model,
        config.computeType,
        config.batched ? "1" : "0",
        config.modelsDir,
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    child = proc;
    let stderrTail = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    return new Promise<void>((resolve, reject) => {
      readline.createInterface({ input: proc.stdout }).on("line", (line) => {
        let message: {
          ready?: boolean;
          id?: string;
          error?: string;
        } & Partial<AudioTranscript>;
        try {
          message = JSON.parse(line);
        } catch {
          return; // a stray print from a library, not the protocol
        }
        if (message.ready) return resolve();
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
        const error = new Error(`${reason}\n${stderrTail}`);
        if (child === proc) {
          child = null;
          ready = null;
        }
        reject(error);
        failAll(error);
      };
      proc.on("error", (e) => onGone(`Local Whisper worker failed: ${e}`));
      proc.on("exit", (code, signal) =>
        onGone(`Local Whisper worker exited (code ${code}, signal ${signal})`)
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
    ready ??= start();
    await ready;
    const id = String(++nextId);
    const result = new Promise<AudioTranscript>((resolve, reject) =>
      pending.set(id, { resolve, reject })
    );
    child?.stdin.write(JSON.stringify({ id, audio: audioPath }) + "\n");
    try {
      return await result;
    } finally {
      if (pending.size === 0) armIdleTimer();
    }
  };

  return { transcribe, stop };
};

const engineConfig = Config.literal(
  "openai",
  "local"
)("CVM_WHISPER_ENGINE").pipe(Config.withDefault("openai" as const));

const workerConfig = Config.all({
  python: Config.string("CVM_WHISPER_PYTHON"),
  model: Config.string("CVM_WHISPER_MODEL").pipe(
    Config.withDefault("large-v3-turbo")
  ),
  computeType: Config.string("CVM_WHISPER_COMPUTE_TYPE").pipe(
    Config.withDefault("float16")
  ),
  batched: Config.boolean("CVM_WHISPER_BATCHED").pipe(Config.withDefault(true)),
  modelsDir: Config.option(Config.string("CVM_WHISPER_MODELS_DIR")).pipe(
    Config.map(Option.getOrElse(() => ""))
  ),
  idleMs: Config.number("CVM_WHISPER_IDLE_MINUTES").pipe(
    Config.withDefault(10),
    Config.map((minutes) => minutes * 60_000)
  ),
});

/**
 * `LocalWhisperDisabled` unless `CVM_WHISPER_ENGINE=local`; then the worker,
 * stopped with the Sidecar.
 */
export const LocalWhisperEngineLive = Layer.unwrapScoped(
  Effect.gen(function* () {
    const engine = yield* engineConfig;
    if (engine === "openai") return LocalWhisperDisabled;
    const config = yield* workerConfig;
    const worker = yield* Effect.acquireRelease(
      Effect.sync(() => makeWorker(config)),
      (w) => Effect.sync(() => w.stop())
    );
    yield* Effect.logInfo("Local Whisper enabled", {
      model: config.model,
      computeType: config.computeType,
      batched: config.batched,
    });
    return Layer.succeed(LocalWhisperEngine, {
      enabled: true,
      transcribe: (audioPath: string) =>
        Effect.tryPromise({
          try: () => worker.transcribe(audioPath),
          catch: (cause) =>
            new LocalWhisperError({
              cause,
              message: `Local Whisper failed: ${cause}`,
            }),
        }).pipe(
          Effect.timeoutFail({
            duration: REQUEST_TIMEOUT,
            onTimeout: () =>
              new LocalWhisperError({
                cause: null,
                message: `Local Whisper took longer than ${Duration.format(REQUEST_TIMEOUT)}`,
              }),
          })
        ),
    });
  })
);
