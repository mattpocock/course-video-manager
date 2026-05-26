import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeAction } from "@/services/route-action.server";
import { CoursePublishService } from "@/services/course-publish-service";

const purgeExportsSchema = Schema.Struct({
  versionId: Schema.String.pipe(Schema.minLength(1)),
});

export const action = makeAction({
  input: "formData",
  dump: false,
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { versionId } =
        yield* Schema.decodeUnknown(purgeExportsSchema)(payload);

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
      )
    ),
});
