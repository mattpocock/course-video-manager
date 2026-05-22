import { Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.purge-exports";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { FileSystem } from "@effect/platform";
import { CoursePublishService } from "@/services/course-publish-service";

const purgeExportsSchema = Schema.Struct({
  versionId: Schema.String.pipe(Schema.minLength(1)),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const { versionId } =
      yield* Schema.decodeUnknown(purgeExportsSchema)(formDataObject);

    const versionOps = yield* VersionOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const publishService = yield* CoursePublishService;

    const videoIds = yield* versionOps.getVideoIdsForVersion(versionId);

    let deletedCount = 0;
    for (const videoId of videoIds) {
      const videoPath = yield* publishService.resolveExportPath(videoId);
      if (!videoPath) continue;
      const exists = yield* fs.exists(videoPath);
      if (exists) {
        yield* fs.remove(videoPath);
        deletedCount++;
      }
    }

    return { success: true, deletedCount, totalVideos: videoIds.length };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        success: false,
        error: `Failed to purge exports: ${error}`,
      })
    ),
    runtimeLive.runPromise
  );
};
