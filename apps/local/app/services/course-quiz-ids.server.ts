import { Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import {
  collectCourseQuizIdUses,
  type QuizIdUse,
} from "@/features/article-writer/quiz-ids";

/** Every quiz id used in one course version, with the video that uses it. */
export const loadCourseQuizIdUses = Effect.fn("loadCourseQuizIdUses")(
  function* (versionId: string) {
    const courseOps = yield* CourseOperationsService;
    const bodies = yield* courseOps.getCourseVideoBodies(versionId);
    return collectCourseQuizIdUses(bodies) satisfies QuizIdUse[];
  }
);

/**
 * The ids one video may not use, because another video in its course already
 * does. Its own ids are excluded — rewriting a body must not collide with the
 * version of itself it is replacing.
 */
export const loadOtherVideosQuizIds = Effect.fn("loadOtherVideosQuizIds")(
  function* (opts: { versionId: string; videoId: string }) {
    const uses = yield* loadCourseQuizIdUses(opts.versionId);
    return [
      ...new Set(
        uses.filter((use) => use.videoId !== opts.videoId).map((use) => use.id)
      ),
    ];
  }
);
