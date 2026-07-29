import { Effect } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishService;

      // This list backs the "unexported videos" detail view; it reflects the
      // full course (include to-do Lessons), matching the default publish. The
      // titles come off the same walk as the existence checks (see
      // course-publish-readiness), so there is no second pass over the tree.
      const { withTodo } = yield* publishService.validatePublishability(
        params.versionId!
      );

      return { videos: withTodo.unexportedVideos };
    }),
});
