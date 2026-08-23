import { Command } from "@effect/platform";
import { Data, Effect, Ref, Stream } from "effect";
import { registerFfmpegChild } from "./ffmpeg-child-registry";
import { createFfmpegProgressParser } from "./ffmpeg-progress";
import { appendBoundedTail, withStderrTail } from "./ffmpeg-log-capture";

/**
 * How every ffmpeg process in this app is started, and the three things every
 * caller of one owes: bitexact output, a durable log, and a child that dies
 * when the fiber that owns it does.
 *
 * It is a module of its own rather than a private helper inside
 * `ffmpeg-commands.ts` because it is the invariant, and the commands are the
 * variations on it.
 */

/** Emitted once a command has run (success or failure) so a caller that
 * knows the domain object (a videoId) can tee it into a durable, agent- and
 * human-readable log — see VideoEditorLoggerService's "cli-output" event. */
export type FfmpegLogInfo = { command: string[]; stderrTail: string };

/**
 * Written before every output file in the export pipeline, so that an export's
 * bytes are a function of its inputs and nothing else.
 *
 * Without these, ffmpeg stamps the running library versions into the file — an
 * `encoder=Lavf60.16.100` format tag and an `encoder=Lavc60.31.102 h264_nvenc`
 * stream tag. Neither changes a frame, but both change the SHA256 that the
 * published manifest carries and that AI Hero uses to decide whether a Video is
 * new. Upgrading ffmpeg would otherwise re-ingest the whole catalogue into Mux.
 *
 * They must go on every pass, not just the last: the stream tag is written by
 * the pass that encodes the stream and survives the later stream-copy.
 *
 * Reproducibility here is per-machine — same ffmpeg build, same driver, same
 * GPU. These flags remove the part that was gratuitously variable.
 */
export const BITEXACT_ARGS = [
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
];

export class FFmpegError extends Data.TaggedError("FFmpegError")<{
  cause: unknown;
  message: string;
}> {}

/**
 * Run a long-lived ffmpeg encode with real progress reporting.
 *
 * `-progress pipe:1` makes ffmpeg emit key=value progress blocks on
 * stdout (which nothing else uses), parsed incrementally into integer
 * percents of `totalDurationSeconds` (see createFfmpegProgressParser for
 * the emission contract). `-nostats` drops the carriage-return stats
 * line from the inherited stderr, which otherwise duplicates the same
 * numbers as terminal noise.
 *
 * Runs under a scope, so fiber interruption (SSE disconnect, cancelled
 * publish) kills the child; the PID is also registered with the
 * parent-death backstop (see ffmpeg-child-registry) for the case where
 * the dev server itself dies without interrupting any fiber.
 *
 * Both stdout (progress) and stderr (diagnostics) are piped rather than
 * inherited, and BOTH are drained concurrently via a single
 * `Effect.all`. That concurrency is load-bearing, not incidental: a
 * piped OS stream that nobody reads fills its buffer (~64KB) and blocks
 * the writer, so draining stdout to completion before even starting to
 * drain stderr would recreate, on stderr, the exact hang this function
 * exists to prevent on stdout.
 *
 * Each drained chunk is handled in isolation — a throw anywhere
 * downstream of `onProgress` (most plausibly an SSE controller whose
 * client has gone away) must never stop that stream's loop. If it did,
 * nobody would read that pipe again, ffmpeg's next write to it would
 * block on a full buffer, and the encode would hang forever — a hang
 * invisible to `Effect.retry`, since a process that never exits never
 * resolves to a failure to retry.
 */
export const runFfmpegWithProgress = Effect.fn("runFfmpegWithProgress")(
  function* (opts: {
    args: string[];
    totalDurationSeconds: number;
    onProgress: ((percent: number) => void) | undefined;
    // Required, not optional: an omitted onLog silently drops the
    // per-video log this function exists to feed — see the
    // "optional parameters" note in .sandcastle/CODING_STANDARDS.md.
    // A caller with nothing to do about it passes a no-op explicitly.
    onLog: (info: FfmpegLogInfo) => void;
    errorPrefix: string;
  }) {
    const commandLine = ["ffmpeg", ...opts.args];
    const toError = (cause: unknown, detail: string, stderrTail: string) =>
      new FFmpegError({
        cause,
        message: withStderrTail(`${opts.errorPrefix}${detail}`, stderrTail),
      });

    yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* Command.start(
          Command.make(
            "ffmpeg",
            "-nostats",
            "-progress",
            "pipe:1",
            ...opts.args
          )
        ).pipe(Effect.mapError((e) => toError(e, `: ${e.message}`, "")));

        yield* Effect.acquireRelease(
          Effect.sync(() => registerFfmpegChild(child.pid)),
          (unregister) => Effect.sync(unregister)
        );

        const parser = createFfmpegProgressParser({
          totalDurationSeconds: opts.totalDurationSeconds,
          onPercent: opts.onProgress ?? (() => {}),
        });

        // Drain stdout even when nobody listens — an unread pipe would
        // eventually block ffmpeg. The stream ends when the process
        // does. A failing chunk (see the function doc) is contained
        // right here, per chunk, so the loop keeps running instead of
        // Effect.ignore below only stopping it after the fact.
        const drainStdout = child.stdout.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => parser.push(chunk)).pipe(
              Effect.catchAllCause(() => Effect.void)
            )
          ),
          Effect.ignore
        );

        // Tee stderr to our own stderr (so a developer watching the
        // terminal sees what they always have) while accumulating a
        // bounded tail for the error message and the per-video log.
        // Written into a Ref rather than folded through the stream's
        // own return value: a Ref keeps whatever was captured so far
        // even if the stream itself dies partway (a decode error, a
        // closed fd) — the same per-chunk containment as stdout above,
        // so one bad chunk can't cost the whole tail.
        const stderrTailRef = yield* Ref.make("");
        const drainStderr = child.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => {
              try {
                process.stderr.write(chunk);
              } catch {
                // Best-effort tee only; never let a closed fd stop capture.
              }
            }).pipe(
              Effect.zipRight(
                Ref.update(stderrTailRef, (tail) =>
                  appendBoundedTail(tail, chunk)
                )
              ),
              Effect.catchAllCause(() => Effect.void)
            )
          ),
          Effect.ignore
        );

        yield* Effect.all([drainStdout, drainStderr], {
          concurrency: 2,
        });
        const stderrTail = yield* Ref.get(stderrTailRef);

        opts.onLog({ command: commandLine, stderrTail });

        const code = yield* child.exitCode.pipe(
          Effect.mapError((e) => toError(e, `: ${e.message}`, stderrTail))
        );
        if (code !== 0) {
          yield* toError(null, `, exit code: ${code}`, stderrTail);
        }
      })
    );
  }
);
