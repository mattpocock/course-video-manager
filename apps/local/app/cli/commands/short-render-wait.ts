import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { RENDER_VERTICAL_EVENTS } from "@/features/jobs/render-vertical-job";
import { followJob, jobFailureOf } from "./job-follow";

/**
 * `cvm short render`: follow the `render-vertical` Job the Sidecar runs until
 * it settles (`followJob`), and say what its last word means.
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
    const job = yield* followJob({ ...input, what: "the render" });
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
        const error = jobFailureOf(job);
        return yield* Effect.fail<ShortRenderJobFailure>({
          _tag: error.tag ?? "ShortRenderFailedError",
          message: error.message ?? "the vertical render failed",
        });
      }
      case "interrupted":
      case "cancelled":
        return yield* new ShortRenderInterruptedError({
          jobId: job.id,
          message: `the render Job ${job.id} was cut off (its Sidecar stopped). Run 'cvm short render' again.`,
        });
    }
  }
);
