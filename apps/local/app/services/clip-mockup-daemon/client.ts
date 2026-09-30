import { Data, Effect, Schedule, Schema } from "effect";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { SpeechSynthesisError } from "../clip-mockup-speech-service";
import { FrameCaptureError } from "../frame-capture-service";
import {
  CaptureResponse,
  DAEMON_LAUNCHER,
  daemonPaths,
  daemonVersion,
  SpeakResponse,
  VersionResponse,
  type CaptureRequest,
  type DaemonPaths,
  type SpeakRequest,
} from "./protocol";

/**
 * THE `cvm` HALF of the Clip Mockup daemon: find the daemon for this checkout,
 * start it if there is none, and hand it frames to capture and lines to voice.
 *
 * Two entry points, one per kind of work, and each fails with the error that
 * kind of work has always failed with — `FrameCaptureError` and
 * `SpeechSynthesisError` — so an agent reads the same failure whether the
 * daemon was already warm, had to be started, or could not be.
 */

/** How long a fresh daemon gets to open its socket. It loads no model to do so. */
const START_TIMEOUT_MS = 30_000;

class DaemonUnavailable extends Data.TaggedError("DaemonUnavailable")<{
  readonly message: string;
}> {}

/** One HTTP request over the daemon's Unix socket. */
const request = (
  socket: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
) =>
  Effect.async<string, DaemonUnavailable>((resume) => {
    const req = http.request(
      {
        socketPath: socket,
        method,
        path,
        agent: false,
        headers: { "content-type": "application/json", connection: "close" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resume(Effect.succeed(Buffer.concat(chunks).toString("utf8")))
        );
      }
    );
    req.on("error", (error) =>
      resume(Effect.fail(new DaemonUnavailable({ message: error.message })))
    );
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });

const decode = <A, I>(schema: Schema.Schema<A, I>, text: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(JSON.parse(text)),
    catch: () =>
      new DaemonUnavailable({
        message: `the daemon answered with something unreadable: ${text.slice(0, 200)}`,
      }),
  });

const ping = (paths: DaemonPaths) =>
  request(paths.socket, "GET", "/version").pipe(
    Effect.flatMap((text) => decode(VersionResponse, text))
  );

/** Start a daemon of this version, detached, writing to its own log. */
const start = (paths: DaemonPaths) =>
  Effect.try({
    try: () => {
      fs.mkdirSync(paths.dir, { recursive: true });
      const out = fs.openSync(paths.log, "a");
      const child = spawn(process.execPath, [DAEMON_LAUNCHER], {
        detached: true,
        stdio: ["ignore", out, out],
        cwd: os.homedir(),
        env: process.env,
      });
      child.unref();
      fs.closeSync(out);
    },
    catch: (cause) =>
      new DaemonUnavailable({
        message: `could not start the Clip Mockup daemon: ${String(cause)}`,
      }),
  });

/**
 * The socket of a running daemon for THIS checkout's code, starting one if
 * needed. Two `cvm` processes that race here both start one; the daemon's
 * lock lets exactly one of them live, and both then find it.
 */
const findOrStartDaemon = Effect.gen(function* () {
  const paths = daemonPaths(daemonVersion());
  const running = yield* Effect.option(ping(paths));
  if (running._tag === "Some") return paths;

  yield* start(paths);
  yield* ping(paths).pipe(
    Effect.retry(
      Schedule.spaced("100 millis").pipe(
        Schedule.upTo(`${START_TIMEOUT_MS} millis`)
      )
    ),
    Effect.mapError(
      () =>
        new DaemonUnavailable({
          message: `the Clip Mockup daemon did not start within ${START_TIMEOUT_MS / 1000}s. Its log is ${paths.log}`,
        })
    )
  );
  return paths;
});

/**
 * `findOrStartDaemon`, once per `cvm` process. `add` captures and voices at
 * the same time, and without this both halves found no daemon and both
 * started one. A success is kept for the life of the process, which is one
 * command; a failure is not, so a later call tries again.
 */
let found: DaemonPaths | undefined;
const starting = Effect.runSync(Effect.makeSemaphore(1));
const ensureDaemon = starting.withPermits(1)(
  Effect.suspend(() =>
    found !== undefined
      ? Effect.succeed(found)
      : Effect.tap(findOrStartDaemon, (paths) => {
          found = paths;
        })
  )
);

/**
 * Capture every page as a 1920x1080 PNG at its `outputPath`. All of them, or
 * a `FrameCaptureError` naming the first page that failed.
 */
export const captureFramesInDaemon = (items: CaptureRequest["items"]) =>
  Effect.gen(function* () {
    const paths = yield* ensureDaemon;
    const text = yield* request(paths.socket, "POST", "/capture", { items });
    const answer = yield* decode(CaptureResponse, text);
    if (!answer.ok) {
      return yield* new FrameCaptureError({
        htmlPath: answer.htmlPath,
        cause: null,
        message: answer.message,
      });
    }
  }).pipe(
    Effect.catchTag(
      "DaemonUnavailable",
      (e) =>
        new FrameCaptureError({
          htmlPath: items[0]?.htmlPath ?? "",
          cause: null,
          message: e.message,
        })
    )
  );

/**
 * Voice every line as a WAV at its `outputPath`, and hand back how long each
 * one runs, in order. All of them, or a `SpeechSynthesisError`.
 */
export const speakLinesInDaemon = (items: SpeakRequest["items"]) =>
  Effect.gen(function* () {
    const paths = yield* ensureDaemon;
    const text = yield* request(paths.socket, "POST", "/speak", { items });
    const answer = yield* decode(SpeakResponse, text);
    if (!answer.ok) {
      return yield* new SpeechSynthesisError({
        cause: null,
        message: answer.message,
      });
    }
    return answer.durationsSeconds;
  }).pipe(
    Effect.catchTag(
      "DaemonUnavailable",
      (e) => new SpeechSynthesisError({ cause: null, message: e.message })
    )
  );
