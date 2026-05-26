import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { data } from "react-router";
import { CoursePublishService } from "@/services/course-publish-service";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  dump: false,
  effect: ({ params }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const publishService = yield* CoursePublishService;
      const videoPath = yield* publishService.resolveExportPath(
        params.videoId!
      );

      if (!videoPath) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      const fileExists = yield* fs.exists(videoPath);
      if (!fileExists) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      yield* fs.remove(videoPath);

      return { success: true };
    }),
});
