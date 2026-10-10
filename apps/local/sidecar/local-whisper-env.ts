import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Effect, Stream } from "effect";
import { LocalWhisperError } from "@/services/local-whisper-engine";

/**
 * Local Whisper's Python env and model cache, made ready by the Sidecar when
 * it starts, with no setup by hand.
 *
 * Both live outside every checkout, in `~/.cache/cvm/whisper`, so Matt's
 * checkout, each worktree and each verify-cvm run share one 2 GB env and one
 * 1.6 GB model download:
 *
 * - `envs/<key>/`: a venv built from `local-whisper/requirements.lock`
 *   (pinned, hashed). `<key>` hashes the lock and the Python version, so a
 *   changed lock or a new system Python gets a fresh env beside the old one,
 *   and an unchanged one is reused at once. An env is built in a temp
 *   directory and renamed into place only once complete, so a build that
 *   dies half-way, or two Sidecars starting at once, never leave a broken
 *   one behind.
 * - `models/`: the Hugging Face cache the worker loads from.
 */

export const WHISPER_CACHE_DIR = path.join(
  os.homedir(),
  ".cache",
  "cvm",
  "whisper"
);
export const WHISPER_MODELS_DIR = path.join(WHISPER_CACHE_DIR, "models");

export const WORKER_DIR = path.join(import.meta.dirname, "local-whisper");
export const WORKER_SCRIPT = path.join(WORKER_DIR, "worker.py");
const LOCK_FILE = path.join(WORKER_DIR, "requirements.lock");

const READY_MARKER = ".cvm-ready";

/** The fix every env failure names: make python3 + venv work, restart. */
const ENV_FIX =
  "Fix: make sure `python3 -m venv` works (`sudo apt install python3-venv`) and the network is up, then restart the Sidecar.";

interface RunResult {
  readonly code: number | null;
  readonly tail: string;
}

/**
 * Runs a command to its end, handing each line it prints to `onLine` as it
 * comes (so a long pip install shows progress); keeps the last few for errors.
 */
const run = (
  command: string,
  args: readonly string[],
  onLine: (line: string) => Effect.Effect<void>
): Effect.Effect<RunResult> =>
  Effect.gen(function* () {
    const tail: string[] = [];
    let code: number | null = null;
    yield* Stream.async<string>((emit) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" },
      });
      const line = (text: string) => {
        if (text.trim()) void emit.single(text);
      };
      readline.createInterface({ input: child.stdout }).on("line", line);
      readline.createInterface({ input: child.stderr }).on("line", line);
      child.on("error", (e) => {
        line(String(e));
        void emit.end();
      });
      child.on("close", (exitCode) => {
        code = exitCode;
        void emit.end();
      });
    }).pipe(
      Stream.runForEach((text) => {
        tail.push(text);
        if (tail.length > 20) tail.shift();
        return onLine(text);
      })
    );
    return { code, tail: tail.join("\n") };
  });

const quiet = () => Effect.void;

const fail = (message: string, cause: unknown = null) =>
  new LocalWhisperError({ cause, message });

/** `python3 --version`, or a LocalWhisperError naming the fix. */
const pythonVersion = run("python3", ["--version"], quiet).pipe(
  Effect.filterOrFail(
    (r) => r.code === 0,
    (r) =>
      fail(
        `Local Whisper needs python3 on the Sidecar's PATH, and it is missing (${r.tail}). Fix: \`sudo apt install python3 python3-venv\`, then restart the Sidecar.`,
        r.tail
      )
  ),
  Effect.map((r) => r.tail.trim())
);

/** Where the env for this lock and this Python lives. */
export const envKey = (lockContents: string, version: string): string =>
  crypto
    .createHash("sha256")
    .update(version)
    .update("\0")
    .update(lockContents)
    .digest("hex")
    .slice(0, 16);

const envPython = (envDir: string) => path.join(envDir, "bin", "python");

const step = (
  label: string,
  command: string,
  args: readonly string[],
  onLine: (line: string) => Effect.Effect<void>
) =>
  run(command, args, onLine).pipe(
    Effect.filterOrFail(
      (r) => r.code === 0,
      (r) =>
        fail(`${label} failed (exit ${r.code}):\n${r.tail}\n${ENV_FIX}`, r.tail)
    )
  );

/**
 * The pinned env's Python, building the env first if it is not there yet
 * (a few minutes and ~2 GB, once per lock). Idempotent.
 */
export const ensureWhisperEnv = Effect.gen(function* () {
  const version = yield* pythonVersion;
  const lock = fs.readFileSync(LOCK_FILE, "utf8");
  const envsDir = path.join(WHISPER_CACHE_DIR, "envs");
  const envDir = path.join(envsDir, envKey(lock, version));
  if (fs.existsSync(path.join(envDir, READY_MARKER))) {
    yield* Effect.logInfo(`Local Whisper: Python env ready (${envDir})`);
    return envPython(envDir);
  }

  yield* Effect.logInfo(
    `Local Whisper: building its Python env (${version}) in ${envDir}. First run downloads ~2 GB; later starts reuse it.`
  );
  fs.mkdirSync(envsDir, { recursive: true });
  const building = `${envDir}.building-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  // pip's "Ignoring <pkg>: markers don't match" is one line per pin for
  // other platforms; everything else is progress worth seeing.
  const log = (line: string) =>
    line.startsWith("Ignoring ")
      ? Effect.void
      : Effect.logInfo(`Local Whisper env: ${line}`);

  const build = Effect.gen(function* () {
    yield* step("Creating the venv", "python3", ["-m", "venv", building], log);
    yield* step(
      "Installing requirements.lock",
      envPython(building),
      [
        "-m",
        "pip",
        "install",
        "--progress-bar",
        "off",
        "--require-hashes",
        "-r",
        LOCK_FILE,
      ],
      log
    );
    fs.writeFileSync(path.join(building, READY_MARKER), `${version}\n`);
    yield* Effect.try(() => fs.renameSync(building, envDir)).pipe(
      Effect.catchAll((e) =>
        // Another Sidecar finished the same env first: use theirs.
        fs.existsSync(path.join(envDir, READY_MARKER))
          ? Effect.sync(() =>
              fs.rmSync(building, { recursive: true, force: true })
            )
          : Effect.die(e)
      )
    );
  });

  yield* build.pipe(
    Effect.catchAllDefect((cause) =>
      Effect.fail(
        fail(`Building Local Whisper's env failed: ${cause}. ${ENV_FIX}`, cause)
      )
    ),
    Effect.tapError(() =>
      Effect.sync(() => fs.rmSync(building, { recursive: true, force: true }))
    )
  );
  yield* Effect.logInfo("Local Whisper: Python env ready");
  return envPython(envDir);
});

/**
 * Downloads `model` into {@link WHISPER_MODELS_DIR} unless it is there
 * already (no network then). Logs before a download so a slow first start is
 * explained.
 */
export const ensureWhisperModel = (python: string, model: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(
      `Local Whisper: checking for ${model} in ${WHISPER_MODELS_DIR} (downloads ~1.6 GB the first time)`
    );
    const started = Date.now();
    yield* step(
      `Downloading the Whisper model ${model}`,
      python,
      ["-I", WORKER_SCRIPT, "--prefetch", model, WHISPER_MODELS_DIR],
      quiet
    );
    yield* Effect.logInfo(
      `Local Whisper: ${model} ready (${((Date.now() - started) / 1000).toFixed(1)} s)`
    );
  });
