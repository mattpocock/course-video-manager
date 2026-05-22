import { Effect } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.courseVersions.$versionId.unexported-videos";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { versionId } = args.params;

  return Effect.gen(function* () {
    const publishService = yield* CoursePublishService;
    const versionOps = yield* VersionOperationsService;

    const { unexportedVideoIds } =
      yield* publishService.validatePublishability(versionId);

    // Map unexported video IDs to display paths
    const version = yield* versionOps.getVersionWithSections(versionId);
    const unexportedVideos: Array<{ id: string; title: string }> = [];

    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        if (lesson.fsStatus === "ghost") continue;
        for (const video of lesson.videos) {
          if (unexportedVideoIds.includes(video.id)) {
            unexportedVideos.push({
              id: video.id,
              title: `${section.path}/${lesson.path}/${video.path}`,
            });
          }
        }
      }
    }

    return { videos: unexportedVideos };
  }).pipe(
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Version not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
