import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { RENDER_VERTICAL_EVENTS } from "@/features/jobs/render-vertical-job";

/**
 * `cvm short render`: follow the `render-vertical` Job the Sidecar runs until
 * it settles. A failed attempt that has attempts left goes back to `queued`,
 * so only the Job's last word counts.
 */

/** The Job was cut off and not put back (its Sidecar stopped mid-render). */
export class ShortRenderInterruptedError extends Data.TaggedError(
  "ShortRenderInterruptedError"
)<{ readonly jobId: string; readonly message: string }> {}

/** The Job is gone, or succeeded without saying which file it wrote. */
export class ShortRenderLostError extends Data.TaggedError(
  "ShortRenderLostError"
)<{ readonly jobId: string; readonly message: string }> {}

/** The render's own failure, as the Job recorded it: its `_tag` and message. */
export interface ShortRenderJobFailure {
  readonly _tag: string;
  readonly message: string;
}

export const waitForShortRender = Effect.fn("waitForShortRender")(
  function* (input: {
    readonly jobId: string;
    readonly pollMs: number;
    /** A line for STDERR: only ever that the Sidecar is not running. */
    readonly onWaiting: (line: Record<string, unknown>) => Effect.Effect<void>;
  }) {
    const ops = yield* JobOperationsService;
    let warnedNoSidecar = false;
    while (true) {
      const job = yield* ops.getJob(input.jobId);
      if (!job) {
        return yield* new ShortRenderLostError({
          jobId: input.jobId,
          message: `no Job ${input.jobId}: it was never enqueued, or was deleted`,
        });
      }
      switch (job.status) {
        case "succeeded": {
          const events = yield* ops.listJobEvents(job.id);
          const path = (
            events.findLast((e) => e.type === RENDER_VERTICAL_EVENTS.rendered)
              ?.data as { path?: unknown } | undefined
          )?.path;
          if (typeof path === "string") return path;
          return yield* new ShortRenderLostError({
            jobId: job.id,
            message: `the render Job ${job.id} succeeded but did not record its file: look in finished-videos/`,
          });
        }
        case "failed": {
          const error = job.error as {
            tag?: string | null;
            message?: string;
          } | null;
          return yield* Effect.fail<ShortRenderJobFailure>({
            _tag: error?.tag ?? "ShortRenderFailedError",
            message: error?.message ?? "the vertical render failed",
          });
        }
        case "interrupted":
        case "cancelled":
          return yield* new ShortRenderInterruptedError({
            jobId: job.id,
            message: `the render Job ${job.id} was cut off (its Sidecar stopped). Run 'cvm short render' again.`,
          });
        case "queued": {
          if (!warnedNoSidecar) {
            const lease = yield* ops.getSidecarLease();
            if (!lease || lease.leaseUntil.getTime() < Date.now()) {
              warnedNoSidecar = true;
              yield* input.onWaiting({
                event: "waiting",
                message:
                  "the sidecar is not running: the render starts when it does (`pnpm dev` or `pnpm start` runs it)",
              });
            }
          }
          break;
        }
        case "running":
          break;
      }
      yield* Effect.sleep(input.pollMs);
    }
  }
);
