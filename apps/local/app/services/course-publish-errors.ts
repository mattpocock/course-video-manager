import { Data } from "effect";

export class PublishValidationError extends Data.TaggedError(
  "PublishValidationError"
)<{
  courseViewLintCount?: number;
  failedExportVideoIds?: string[];
  missingVideoIds?: string[];
  unfrozenCourseVersionId?: string;
}> {}

/**
 * A caught Commit failure. Per issue #1401 this is TERMINAL, not recoverable:
 * the Pending Version has already been auto-Discarded by the time this error
 * surfaces (after one in-flight retry for `sync_failed`; immediately for
 * `missing_assets`). Nothing is lost — the Submitted content lives on,
 * unchanged, in the new Draft — so recovery is simply "fix the cause and
 * publish again".
 */
export class PublishCommitFailedError extends Data.TaggedError(
  "PublishCommitFailedError"
)<{
  discardedVersionId: string;
  newDraftVersionId: string;
  reason: "sync_failed" | "missing_assets";
  missingVideoIds?: string[];
  /**
   * What actually broke, for a `sync_failed`. The reason code names the PHASE;
   * this names the failure inside it — a missing `DROPBOX_APP_KEY`, a rejected
   * upload — which is the only part an author can act on. Optional because
   * `missing_assets` says everything in `missingVideoIds`. The CLI renders it:
   * `serializeError` in `app/cli/render.ts` asks for `message` by name.
   */
  message?: string;
}> {}

export class ExportError extends Data.TaggedError("ExportError")<{
  message: string;
}> {}
