import { Data } from "effect";

export class PublishValidationError extends Data.TaggedError(
  "PublishValidationError"
)<{
  courseViewLintCount?: number;
  failedExportVideoIds?: string[];
  missingVideoIds?: string[];
  unfrozenCourseVersionId?: string;
}> {}

export class DropboxCommitPendingError extends Data.TaggedError(
  "DropboxCommitPendingError"
)<{
  // The Submitted Version, now durably Pending, whose Dropbox commit did not
  // land. It is NOT Published (the commit failed), so it must not be named as
  // such — recovery retries or discards this exact Pending Version.
  pendingVersionId: string;
  newDraftVersionId: string;
  reason: "sync_failed" | "missing_assets";
  includeTodoLessons: boolean;
  missingVideoIds?: string[];
}> {}

export class ExportError extends Data.TaggedError("ExportError")<{
  message: string;
}> {}
