import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Queue,
  Runtime,
  Schedule,
  Schema,
} from "effect";
import fs from "node:fs";
import http from "node:http";
import { ClipMockupSpeechService } from "../clip-mockup-speech-service";
import { FrameCaptureService } from "../frame-capture-service";
import {
  CaptureRequest,
  CaptureResponse,
  DAEMON_IDLE_MS,
  daemonPaths,
  daemonVersion,
  SpeakRequest,
  SpeakResponse,
  VersionResponse,
} from "./protocol";

/**
 * THE CLIP MOCKUP DAEMON: one process per machine (per checkout, strictly)
 * that turns HTML into frames and lines into speech for every `cvm
 * clip-mockup` call. `cvm` starts it on first use; it stops itself after
 * `DAEMON_IDLE_MS` with nothing to do. Why it exists is in `protocol.ts` and
 * ADR 0031.
 *
 * ONE KOKORO WORKER. Every line of every call goes through one queue to one
 * model, first come first served. A second model was measured: two worker
 * processes voiced ~1.2x as fast, but each one costs another 1-3GB of the
 * card, and it is the card running out that made parallel calls slow. The
 * queue is a real FIFO (`Queue` with one taker), and a call's lines are one
 * job, so a call is never split around another call's lines.
 *
 * ONE CHROMIUM. `FrameCaptureService` holds the browser and limits how many
 * pages are open; captures do not wait behind speech, because the one runs on
 * the CPU and the other on the GPU.
 *
 * A daemon that fails to start does not matter much: `cvm` waits for the
 * socket, and names this daemon's log file if it never answers.
 */

const log = (message: string) =>
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);

/** Is there a live process with this pid? EPERM means yes, owned by another user. */
const isAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Take the one lock for this version, or report that a live daemon holds it.
 *
 * Two `cvm` calls that find no daemon both start one. The loser finds the
 * winner's pid in the lock and exits at once. A lock left by a daemon that
 * crashed names a dead pid and is taken over. (Two starters that BOTH find
 * the same dead pid can each take it over; the later one then owns the socket
 * and the earlier one gets no requests and stops at its idle time, with no
 * model loaded. That window is a few microseconds wide.)
 */
const acquireLock = (lockPath: string): boolean => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = Number(fs.readFileSync(lockPath, "utf8"));
      if (isAlive(holder)) return false;
      fs.rmSync(lockPath, { force: true });
    }
  }
  return false;
};

const messageOf = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.failureOption(cause);
  const error = failure._tag === "Some" ? failure.value : Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

/** One call's lines, voiced together, and where its answer goes. */
interface SpeakJob {
  readonly items: SpeakRequest["items"];
  readonly done: Deferred.Deferred<ReadonlyArray<number>, string>;
}

const daemon = (version: string) =>
  Effect.gen(function* () {
    const paths = daemonPaths(version);
    const fileSystem = yield* FileSystem.FileSystem;
    const capture = yield* FrameCaptureService;

    // -- The one Kokoro worker ---------------------------------------------
    // The model loads on the first line, not at start: a call whose lines are
    // all cached, or that only swaps frames, never touches the GPU.
    const jobs = yield* Queue.unbounded<SpeakJob>();
    let voice: ClipMockupSpeechService | undefined;
    const loadVoice = ClipMockupSpeechService.pipe(
      Effect.provide(ClipMockupSpeechService.Default)
    );

    const runJob = (job: SpeakJob) =>
      Effect.gen(function* () {
        voice ??= yield* loadVoice;
        const durations: number[] = [];
        for (const item of job.items) {
          const spoken = yield* voice.synthesizeLine(item.line);
          yield* fileSystem.writeFile(item.outputPath, spoken.wav);
          durations.push(spoken.durationSeconds);
        }
        return durations;
      });

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const job = yield* Queue.take(jobs);
          const exit = yield* Effect.exit(runJob(job));
          yield* Deferred.done(
            job.done,
            Exit.mapErrorCause(exit, (cause) => Cause.fail(messageOf(cause)))
          );
        })
      )
    );

    // -- The two requests --------------------------------------------------
    const speak = (request: SpeakRequest) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<ReadonlyArray<number>, string>();
        yield* Queue.offer(jobs, { items: request.items, done });
        const exit = yield* Effect.exit(Deferred.await(done));
        return Exit.match(exit, {
          onSuccess: (durations): typeof SpeakResponse.Type => ({
            ok: true,
            durationsSeconds: durations,
          }),
          onFailure: (cause): typeof SpeakResponse.Type => ({
            ok: false,
            message: messageOf(cause),
          }),
        });
      });

    const captureAll = (request: CaptureRequest) =>
      Effect.forEach(request.items, (item) => capture.captureHtmlToPng(item), {
        concurrency: "unbounded",
        discard: true,
      }).pipe(
        Effect.as<typeof CaptureResponse.Type>({ ok: true }),
        Effect.catchTag(
          "FrameCaptureError",
          (e): Effect.Effect<typeof CaptureResponse.Type> =>
            Effect.succeed({
              ok: false,
              message: e.message,
              htmlPath: e.htmlPath,
            })
        )
      );

    // -- The socket --------------------------------------------------------
    const runtime = yield* Effect.runtime<never>();
    const run = Runtime.runPromise(runtime);
    let inFlight = 0;
    let lastActivity = Date.now();

    const route = async (req: http.IncomingMessage): Promise<unknown> => {
      if (req.method === "GET" && req.url === "/version") {
        return {
          version,
          pid: process.pid,
        } satisfies typeof VersionResponse.Type;
      }
      const body: unknown = JSON.parse(await readBody(req));
      if (req.method === "POST" && req.url === "/capture") {
        const request = Schema.decodeUnknownSync(CaptureRequest)(body);
        log(`capture ${request.items.length} page(s)`);
        return run(captureAll(request));
      }
      if (req.method === "POST" && req.url === "/speak") {
        const request = Schema.decodeUnknownSync(SpeakRequest)(body);
        log(`speak ${request.items.length} line(s)`);
        return run(speak(request));
      }
      throw new Error(`no such request: ${req.method} ${req.url}`);
    };

    const server = http.createServer((req, res) => {
      inFlight++;
      route(req)
        .then(
          (answer) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(answer));
          },
          (error: unknown) => {
            log(`request failed: ${String(error)}`);
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, message: String(error) }));
          }
        )
        .finally(() => {
          inFlight--;
          lastActivity = Date.now();
        });
    });

    // A socket file left by a daemon that crashed would stop `listen`; the
    // lock says that daemon is gone, so the file is ours to replace.
    fs.rmSync(paths.socket, { force: true });
    yield* Effect.async<void, Error>((resume) => {
      server.once("error", (error) => resume(Effect.fail(error)));
      server.listen(paths.socket, () => resume(Effect.void));
    });
    log(`listening on ${paths.socket} (pid ${process.pid})`);

    yield* Effect.addFinalizer(() =>
      Effect.async<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }).pipe(Effect.andThen(() => fs.rmSync(paths.socket, { force: true })))
    );

    // -- Stopping ----------------------------------------------------------
    const stop = yield* Deferred.make<string>();
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => run(Deferred.succeed(stop, signal)));
    }
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.suspend(() =>
          inFlight === 0 && Date.now() - lastActivity > DAEMON_IDLE_MS
            ? Deferred.succeed(stop, "idle")
            : Effect.void
        ),
        Schedule.spaced("10 seconds")
      )
    );

    const reason = yield* Deferred.await(stop);
    log(`stopping: ${reason}`);
  });

/**
 * The daemon's whole life. Returns the process exit code; `daemon.mjs` is the
 * only place that exits.
 */
export const runClipMockupDaemon = async (): Promise<number> => {
  const version = daemonVersion();
  const paths = daemonPaths(version);
  fs.mkdirSync(paths.dir, { recursive: true });

  if (!acquireLock(paths.lock)) {
    log("another daemon of this version is running; exiting");
    return 0;
  }

  const exit = await Effect.runPromiseExit(
    Effect.scoped(daemon(version)).pipe(
      Effect.provide(FrameCaptureService.Default),
      Effect.provide(NodeContext.layer)
    )
  );

  // Only our own lock is removed: a lock that names another pid was taken
  // over by a daemon that is still running.
  const holder = fs.existsSync(paths.lock)
    ? fs.readFileSync(paths.lock, "utf8")
    : undefined;
  if (holder === String(process.pid)) fs.rmSync(paths.lock, { force: true });
  if (Exit.isFailure(exit)) {
    log(`failed: ${messageOf(exit.cause)}`);
    return 1;
  }
  return 0;
};
