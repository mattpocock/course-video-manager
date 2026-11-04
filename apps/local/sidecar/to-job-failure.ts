import { Cause } from "effect";
import type { JobFailure } from "@cvm/core/services/db-job-operations.server";
import { formatFailureCause } from "@/services/format-failure-cause";
import { storageRootOfflineErrorOf } from "@/packages/storage";

/** A Job's failure as `job.error` keeps it: tag, one line, and the whole chain. */
export const toJobFailure = (
  cause: Cause.Cause<unknown>,
  roots: readonly string[] = []
): JobFailure => {
  const squashed = Cause.squash(cause);
  // A Job that needs an Offline Storage Root fails saying which drive, not
  // with the filesystem's ENODEV.
  const error = storageRootOfflineErrorOf(squashed, roots) ?? squashed;
  const tag =
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
      ? error._tag
      : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : String(error);
  return { tag, message, cause: formatFailureCause(squashed) };
};
