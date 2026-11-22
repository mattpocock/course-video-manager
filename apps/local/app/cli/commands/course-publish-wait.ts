import { Data, Effect } from "effect";
import {
  JobOperationsService,
  type JobEvent,
} from "@cvm/core/services/db-job-operations.server";
import {
  PublishCommitFailedError,
  PublishValidationError,
} from "@/services/course-publish-errors";
import { mayLeavePendingVersion } from "@/features/jobs/job-wire";
import { nowMs } from "@/packages/clock";

/**
 * `cvm course publish --wait`: follow a Publish Job the Sidecar runs until it
 * settles, and end as the in-process command did — the same result object on
 * success, the same tagged error (and so the same exit code) on failure.
 */

/** A Publish Job that failed for a reason the in-process command never had a tag for. */
export class PublishJobFailedError extends Data.TaggedError(
  "PublishJobFailedError"
)<{
  readonly jobId: string;
  readonly message: string;
  /** The failure's own tag, as the Job recorded it. */
  readonly cause: string | null;
}> {}

/**
 * A Publish Job cut off mid-run (its sidecar stopped or died). It is never
 * run again on its own: a Pending Version it left is reconciled by hand on
 * the publish page (plan §7.2).
 */
export class PublishInterruptedError extends Data.TaggedError(
  "PublishInterruptedError"
)<{
  readonly jobId: string;
  readonly message: string;
}> {}

/**
 * The Publish Job succeeded but its `published` Job Event is missing (the
 * sidecar's event write failed, and `ctx.emit` swallows that). The release is
 * out; only its ids were lost. Never reported as success with empty ids.
 */
export class PublishResultLostError extends Data.TaggedError(
  "PublishResultLostError"
)<{
  readonly jobId: string;
  readonly message: string;
}> {}

/**
 * The tag a Publish Job fails with when the service REFUSED it (a
 * `PublishValidationError`), as opposed to failing it (`PublishRunError`).
 * The Job's own failure is written by the sidecar's settle, not as a Job
 * Event, so it survives when the `publish-failed` event write did not.
 */
export const PUBLISH_REFUSED_TAG = "PublishRefusedError";

export interface PublishedResult {
  readonly publishedVersionId: string;
  readonly newDraftVersionId: string;
  readonly lessons: unknown;
}

/** One line of what the Job is doing, for STDERR. `null`: not worth a line. */
export const describeJobEvent = (
  event: Pick<JobEvent, "type" | "data">
): Record<string, unknown> | null => {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "queued":
    case "started":
    case "succeeded":
    case "failed":
    case "interrupted":
      return { event: event.type };
    case "stage":
      return { event: "stage", stage: data.stage };
    case "videos":
      return {
        event: "videos",
        count: Array.isArray(data.videos) ? data.videos.length : 0,
      };
    case "video-succeeded":
      return { event: "video-shipped", videoId: data.videoId };
    case "video-failed":
      return {
        event: "video-failed",
        videoId: data.videoId,
        message: data.message,
      };
    default:
      return null;
  }
};

const errorMessageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "The Publish failed";

const errorTagOf = (error: unknown): string | null =>
  typeof error === "object" &&
  error !== null &&
  "tag" in error &&
  typeof error.tag === "string"
    ? error.tag
    : null;

/**
 * The service's own error, rebuilt from the `publish-failed` Job Event the
 * kind writes, so `render.ts` maps it as it always did (3 for a
 * `PublishValidationError`, 4 for a `PublishCommitFailedError`).
 */
const rebuildFailure = (
  job: { readonly id: string; readonly subjectId: string | null },
  events: readonly JobEvent[],
  jobError: unknown
) => {
  const jobId = job.id;
  const failed = events.findLast((e) => e.type === "publish-failed");
  const fields = (failed?.data ?? {}) as Record<string, unknown>;
  const { _tag, ...rest } = fields;
  if (_tag === "PublishValidationError") {
    return new PublishValidationError(
      rest as ConstructorParameters<typeof PublishValidationError>[0]
    );
  }
  if (_tag === "PublishCommitFailedError") {
    return new PublishCommitFailedError(
      rest as ConstructorParameters<typeof PublishCommitFailedError>[0]
    );
  }
  // The `publish-failed` event is a best-effort write; without it, the Job's
  // own failure tag still says whether the Publish was refused (exit 3).
  if (errorTagOf(jobError) === PUBLISH_REFUSED_TAG) {
    return new PublishValidationError({});
  }
  const message = errorMessageOf(jobError);
  const leftPending = mayLeavePendingVersion({
    status: "failed",
    submitted: events.some((e) => e.type === "submitted"),
    errorTag: errorTagOf(jobError),
  });
  return new PublishJobFailedError({
    jobId,
    message: leftPending
      ? `${message}. It failed after Submit, so its Pending Version may be waiting on the web publish page (/courses/${job.subjectId ?? "<courseId>"}/publish): Promote or Discard it there, then publish again.`
      : message,
    cause: errorTagOf(jobError),
  });
};

export const waitForPublishJob = Effect.fn("waitForPublishJob")(
  function* (input: {
    readonly jobId: string;
    readonly pollMs: number;
    /** Called once per Job Event worth a line, in order. */
    readonly onProgress: (line: Record<string, unknown>) => Effect.Effect<void>;
  }) {
    const ops = yield* JobOperationsService;
    let lastEventId = 0;
    let warnedNoSidecar = false;
    while (true) {
      const job = yield* ops.getJob(input.jobId);
      const events = yield* ops.listJobEvents(input.jobId);
      for (const event of events) {
        if (event.id <= lastEventId) continue;
        lastEventId = event.id;
        const line = describeJobEvent(event);
        if (line) yield* input.onProgress(line);
      }
      if (!job) {
        return yield* new PublishJobFailedError({
          jobId: input.jobId,
          message: `no Job ${input.jobId}: it was never enqueued, or was deleted`,
          cause: null,
        });
      }
      switch (job.status) {
        case "succeeded": {
          const published = events.findLast((e) => e.type === "published");
          const data = (published?.data ?? {}) as Record<string, unknown>;
          if (
            typeof data.publishedVersionId !== "string" ||
            typeof data.newDraftVersionId !== "string"
          ) {
            return yield* new PublishResultLostError({
              jobId: job.id,
              message:
                "The Publish Job succeeded, but its result (the published and new Draft version ids) was never recorded. The release is out: see it on the web publish page (/courses/<courseId>/publish); `cvm course get <courseId>` gives the new draftVersionId. Do NOT publish again.",
            });
          }
          return {
            publishedVersionId: data.publishedVersionId,
            newDraftVersionId: data.newDraftVersionId,
            lessons: data.lessons ?? null,
          } satisfies PublishedResult;
        }
        case "failed":
          return yield* rebuildFailure(job, events, job.error);
        case "interrupted":
        case "cancelled":
          return yield* new PublishInterruptedError({
            jobId: job.id,
            message:
              "The Publish was cut off before it finished, and is never re-run on its own. If it got past Submit, its Pending Version is waiting on the web publish page (/courses/<courseId>/publish): Promote or Discard it there, then publish again.",
          });
        case "queued": {
          if (!warnedNoSidecar) {
            const lease = yield* ops.getSidecarLease();
            if (!lease || lease.leaseUntil.getTime() < nowMs()) {
              warnedNoSidecar = true;
              yield* input.onProgress({
                event: "waiting",
                message:
                  "the sidecar is not running: the Publish starts when it does (`pnpm dev` or `pnpm start` runs it)",
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
