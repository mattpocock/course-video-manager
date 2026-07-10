import { Effect } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishService;
      const versionOps = yield* VersionOperationsService;

      // This list backs the "unexported videos" detail view; it reflects the
      // full course (include to-do Lessons), matching the default publish.
      const { withTodo } = yield* publishService.validatePublishability(
        params.versionId!
      );
      const { unexportedVideoIds } = withTodo;

      const version = yield* versionOps.getVersionWithSections(
        params.versionId!
      );
      const unexportedVideos: Array<{ id: string; title: string }> = [];

      for (const section of version.sections) {
        for (const lesson of section.lessons) {
          for (const video of lesson.videos) {
            if (unexportedVideoIds.includes(video.id)) {
              unexportedVideos.push({
                id: video.id,
                title: `${section.path}/${lesson.path}/${video.title}`,
              });
            }
          }
        }
      }

      return { videos: unexportedVideos };
    }),
});
