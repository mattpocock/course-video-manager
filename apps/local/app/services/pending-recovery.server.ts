import { Config, Data, Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { NotFoundError } from "@/services/db-service-errors";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { download } from "./dropbox-http-client";
import { getValidDropboxAccessToken } from "./dropbox-auth-service";

export type PendingRecovery = {
  versionId: string;
  versionName: string;
  receiptState: "committed" | "absent" | "unreadable";
};

export const classifyPendingRecovery = Effect.fn("classifyPendingRecovery")(
  function* (input: { courseId: string; courseName: string }) {
    const versionOps = yield* VersionOperationsService;
    const pending = yield* versionOps.getPendingVersion(input.courseId);
    if (!pending) return null;

    const dropboxRemotePath = yield* Config.string("DROPBOX_REMOTE_PATH");
    const courseJsonPath = `${dropboxRemotePath}/${input.courseName}/course.json`;

    // Attempt to get a valid access token. If Dropbox is not authenticated,
    // refuse to classify — same as "mount unreachable" in the old FS world.
    const accessToken = yield* getValidDropboxAccessToken.pipe(
      Effect.catchAll(() => Effect.succeed(null as string | null))
    );

    if (!accessToken) {
      return {
        versionId: pending.id,
        versionName: pending.name,
        receiptState: "unreadable" as const,
      } satisfies PendingRecovery;
    }

    const receiptState: PendingRecovery["receiptState"] = yield* download({
      accessToken,
      path: courseJsonPath,
    }).pipe(
      Effect.map((buffer): PendingRecovery["receiptState"] => {
        try {
          const doc = JSON.parse(buffer.toString("utf-8")) as {
            courseVersionId?: unknown;
          };
          return doc.courseVersionId === pending.id ? "committed" : "absent";
        } catch {
          return "unreadable";
        }
      }),
      Effect.catchTag("DropboxApiError", (error) =>
        Effect.succeed<PendingRecovery["receiptState"]>(
          error.status === 409 ? "absent" : "unreadable"
        )
      )
    );

    return {
      versionId: pending.id,
      versionName: pending.name,
      receiptState,
    } satisfies PendingRecovery;
  }
);

/**
 * Why `cvm course publish discard` left a Pending Version alone:
 * - `publish-in-flight`: this course's Publish is queued or running, so its
 *   Pending Version is not stranded; that Publish Promotes or Discards it.
 * - `release-landed`: the `course.json` receipt names it, so the release is
 *   out. It is Promoted (on the publish page), never Discarded.
 * - `receipt-unreadable`: Dropbox could not say either way. Discarding a
 *   release that did land would orphan it, so nothing is done.
 */
export class PendingDiscardRefusedError extends Data.TaggedError(
  "PendingDiscardRefusedError"
)<{
  readonly reason:
    "publish-in-flight" | "release-landed" | "receipt-unreadable";
  readonly versionId: string;
  readonly message: string;
}> {}

/**
 * Discard a course's stranded Pending Version (#2621): what the publish
 * page's banner does with its Discard button, for a run with no page. The
 * same guards: a Pending Version with a Publish still in flight, or whose
 * receipt landed or cannot be read, is refused.
 */
export const discardStrandedPendingVersion = Effect.fn(
  "discardStrandedPendingVersion"
)(function* (input: { courseId: string }) {
  const course = yield* (yield* CourseOperationsService).getCourseById(
    input.courseId
  );
  const recovery = yield* classifyPendingRecovery({
    courseId: input.courseId,
    courseName: course.name,
  });
  if (!recovery) {
    return yield* new NotFoundError({
      type: "pending version",
      params: { courseId: input.courseId },
      message: `course ${input.courseId} has no Pending Version`,
    });
  }
  const refuse = (
    reason: PendingDiscardRefusedError["reason"],
    message: string
  ) =>
    new PendingDiscardRefusedError({
      reason,
      versionId: recovery.versionId,
      message,
    });

  const live = yield* (yield* JobOperationsService).listRecentJobs({
    finishedWithinMs: 0,
  });
  if (
    live.some(
      ({ job }) =>
        job.kind === "publish" &&
        job.subjectId === input.courseId &&
        (job.status === "queued" || job.status === "running")
    )
  ) {
    return yield* refuse(
      "publish-in-flight",
      "this course's Publish is still queued or running; it Promotes or Discards its own Pending Version"
    );
  }
  if (recovery.receiptState === "committed") {
    return yield* refuse(
      "release-landed",
      `the course.json receipt names ${recovery.versionName}: the release landed. Promote it on the publish page`
    );
  }
  if (recovery.receiptState === "unreadable") {
    return yield* refuse(
      "receipt-unreadable",
      "the course.json receipt could not be read, so whether the release landed is unknown. Check Dropbox, then try again"
    );
  }
  const discarded =
    yield* (yield* VersionOperationsService).discardPendingVersion(
      recovery.versionId
    );
  return { discardedVersionId: discarded.id, name: discarded.name };
});
