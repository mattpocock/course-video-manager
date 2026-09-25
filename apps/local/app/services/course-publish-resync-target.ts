import { Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { DoesNotExistOnDbError } from "./publish-to-dropbox";
import { PublishValidationError } from "./course-publish-errors";

/**
 * WHICH Course Version a manual re-sync re-commits.
 *
 * The standalone Dropbox mirror is asked for a Course, not for a Version, so
 * something has to choose. The answer is the newest PUBLISHED Version, read off
 * the commit state — authoritative, unlike the position in a list (this used to
 * be inferred as "the first non-latest Version", which quietly picked the wrong
 * one as soon as a Draft was cloned twice).
 *
 * A Course with no Version at all is a database-shaped absence; a Course whose
 * only Version is still a Draft is a validation failure naming that Draft,
 * because there is nothing frozen to re-commit yet.
 */
export const resolveResyncTargetVersionId = Effect.fn(
  "resolveResyncTargetVersionId"
)(function* (courseId: string) {
  const versionOps = yield* VersionOperationsService;
  const latestVersion = yield* versionOps.getLatestCourseVersion(courseId);
  if (!latestVersion) {
    return yield* new DoesNotExistOnDbError({
      type: "section",
      path: "",
      message: `No version found for repo ${courseId}`,
    });
  }
  const latestPublishedVersion =
    yield* versionOps.getLatestPublishedVersion(courseId);
  if (!latestPublishedVersion) {
    return yield* new PublishValidationError({
      unfrozenCourseVersionId: latestVersion.id,
    });
  }
  return latestPublishedVersion.id;
});
