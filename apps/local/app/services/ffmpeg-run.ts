import { Command } from "@effect/platform";
import { Context, Duration, Effect, Ref, Stream } from "effect";
import { registerFfmpegChild } from "./ffmpeg-child-registry";
import { createFfmpegProgressParser } from "./ffmpeg-progress";
import { appendBoundedTail, withStderrTail } from "./ffmpeg-log-capture";
import { SidecarContext } from "./sidecar-context";
import { FfmpegPermitsService } from "./ffmpeg-permits";
import {
  FFmpegError,
  classifyGpuFailure,
  cpuFallbackArgs,
  type FfmpegLogInfo,
} from "./ffmpeg-error";

/**
 * How long a pass waits before each new try when NVENC had no free encoder
 * session (#2141): 5 s, doubling to a minute, eight tries after the first —
 * about five minutes in all. Long enough to outlast a sibling encode or a
 * short burst of recording; short enough that an export stuck behind a whole
 * filming session says so rather than sitting at 0% for an hour.
 *
 * A Context.Reference so a test can shrink it to milliseconds.
 */
export class NvencSessionWaits extends Context.Reference<NvencSessionWaits>()(
  "NvencSessionWaits",
  {
    defaultValue: (): readonly Duration.DurationInput[] => [
      "5 seconds",
      "10 seconds",
      "20 seconds",
      "40 seconds",
      "1 minute",
      "1 minute",
      "1 minute",
      "1 minute",
    ],
  }
) {}

/**
 * How every long ffmpeg ENCODE in this app is started, and the three things
 * every caller of one owes: bitexact output, a durable log, and a child that
 * dies when the fiber that owns it does.
 *
 * An encode is background work: it runs in the **Sidecar**, never in a request
 * (docs/plans/background-jobs-sidecar.md, the spawn guard). So this runner
 * asks for `SidecarContext`, and no module a route can reach may import it
 * (`.dependency-cruiser.cjs`, `spawn-runner-reachable-from-routes`).
 */

// Kept importable from here for the export's tests and passes.
export {
  BITEXACT_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  FFmpegError,
  type FfmpegLogInfo,
} from "./ffmpeg-error";

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
 *
 * It is also where a pass falls back from the GPU. A pass that decodes with
 * NVDEC or encodes with one of the h264_nvenc blocks in `ffmpeg-error.ts` and
 * fails because the GPU could not open — no CUDA context, no capable device —
 * is run once more, whole, on the CPU (`cpuFallbackArgs`), with a WARN in the
 * Job's log. Every caller gets it by construction; none decides for itself.
 *
 * A GPU that is there but has no free NVENC session (OBS, the recorder or
 * another encode holds them all) is different: the pass waits and tries
 * again on the GPU, on the {@link NvencSessionWaits} schedule, with a WARN in
 * the Job's log for each wait. If NVENC still will not open after the last
 * one, the pass FAILS, saying so — it does not go to the CPU. The likeliest
 * reason the sessions are gone is that Matt is recording, which is exactly
 * when a libx264 encode would fight the recorder for the CPU; and a landscape
 * pass encoded on libx264 has different bytes, so a Byte Hash moves and a
 * Publish re-sends that Video (ADR 0027). A failed Job can be re-run once the
 * GPU is free.
 *
 * And it is where the process-wide limit on heavy encodes is kept: a run
 * with `permit: "encode-slot"` — every pass that encodes video — takes one of
 * `FfmpegPermitsService`'s encode slots (default 2) for its whole length,
 * fallback included, and logs when it has to wait for one. A Publish, a Batch
 * export and a Short running side by side share those slots, so no mix of
 * Jobs can stack more encodes than that on the machine's memory (Publish Job
 * 859b8689: six 100-input concats at once ran it out of RAM).
 *
 * A pass that only stream-copies the video — the audio normalize — takes a
 * CPU permit instead (`permit: "cpu-permit"`). It never opens NVENC and holds
 * one input, so it has no business keeping a concat out of a slot: with two
 * slots NVENC sat at 99% while a normalize held one of them idle.
 */
export const runFfmpegWithProgress = Effect.fn("runFfmpegWithProgress")(
  function* (opts: {
    args: string[];
    totalDurationSeconds: number;
    onProgress: ((percent: number) => void) | undefined;
    // Required, not optional: an omitted onLog silently drops the
    // per-video log this function exists to feed — see the
    // "optional parameters" note in CODING_STANDARDS.md.
    // A caller with nothing to do about it passes a no-op explicitly.
    onLog: (info: FfmpegLogInfo) => void;
    errorPrefix: string;
    // Required: which of the process-wide limits this pass counts against.
    // "encode-slot" for anything that encodes video; "cpu-permit" for a pass
    // that stream-copies it (see above).
    permit: "encode-slot" | "cpu-permit";
  }) {
    // An encode is a Job's: only the Sidecar provides this.
    yield* SidecarContext;
    const { withEncodeSlot, cpuSemaphore } = yield* FfmpegPermitsService;
    const withPermit =
      opts.permit === "encode-slot"
        ? withEncodeSlot(opts.errorPrefix)
        : cpuSemaphore.withPermits(1);
    const toError = (cause: unknown, detail: string, stderrTail: string) =>
      new FFmpegError({
        cause,
        message: withStderrTail(`${opts.errorPrefix}${detail}`, stderrTail),
      });

    // The permit is held across the fallback too: the CPU re-run is the
    // hungrier of the two, and must not start outside the limit. And across
    // the NVENC waits: a pass that let go of its slot to wait would only
    // let in another encode that wants the same missing session.
    yield* withPermit(
      Effect.gen(function* () {
        let first = yield* runOnce(opts.args);
        if (first.code === 0) return;

        const waits = yield* NvencSessionWaits;
        let waited = Duration.zero;
        for (const [i, wait] of waits.entries()) {
          if (
            classifyGpuFailure(first.stderrTail) !== "nvenc-sessions-exhausted"
          )
            break;
          yield* Effect.logWarning(
            `ffmpeg: NVENC has no free encoder session (the GPU is busy — OBS, the recorder or another encode); waiting ${Duration.format(wait)} and trying again on the GPU (${i + 1} of ${waits.length})`,
            { errorPrefix: opts.errorPrefix, exitCode: first.code }
          );
          yield* Effect.sleep(wait);
          waited = Duration.sum(waited, wait);
          first = yield* runOnce(opts.args);
          if (first.code === 0) return;
        }
        if (
          classifyGpuFailure(first.stderrTail) === "nvenc-sessions-exhausted"
        ) {
          return yield* toError(
            null,
            `, exit code: ${first.code}: NVENC still had no free encoder session after waiting ${Duration.format(waited)} (${waits.length} retries). The GPU is busy, not missing, so this pass was not moved to the CPU; free the GPU (stop recording, or let other encodes finish) and run the Job again`,
            first.stderrTail
          );
        }

        const fallbackArgs = cpuFallbackArgs(opts.args, first.stderrTail);
        if (!fallbackArgs) {
          return yield* toError(
            null,
            `, exit code: ${first.code}`,
            first.stderrTail
          );
        }

        yield* Effect.logWarning(
          "ffmpeg: the GPU could not open (no usable NVENC/NVDEC); running this pass again on the CPU",
          { errorPrefix: opts.errorPrefix, exitCode: first.code }
        );
        const fallback = yield* runOnce(fallbackArgs);
        if (fallback.code !== 0) {
          return yield* toError(
            null,
            `, exit code: ${fallback.code} (on the CPU fallback, after the GPU could not open)`,
            fallback.stderrTail
          );
        }
      })
    );

    /** One ffmpeg run: its exit code and the tail of its stderr. */
    function runOnce(args: readonly string[]) {
      const commandLine = ["ffmpeg", ...args];
      return Effect.scoped(
        Effect.gen(function* () {
          const child = yield* Command.start(
            Command.make("ffmpeg", "-nostats", "-progress", "pipe:1", ...args)
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
          return { code: Number(code), stderrTail };
        })
      );
    }
  }
);
