import { handleCourseEditorEvent } from "@/services/course-editor-service-handler";
import { CourseEditorEventSchema } from "@/services/course-editor-service.schemas";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { makeAction } from "@/services/route-action.server";
import { Effect, Schema } from "effect";

export const action = makeAction({
  input: "json",
  errors: {
    CourseRepoSyncError: 409,
    NotFoundError: 404,
    CourseWriteError: 400,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknown(CourseEditorEventSchema)(
        payload
      );

      const result = yield* handleCourseEditorEvent(event as CourseEditorEvent);

      return result ?? null;
    }),
});
