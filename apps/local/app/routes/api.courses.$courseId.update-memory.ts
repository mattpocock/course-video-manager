import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeAction } from "@/services/route-action.server";

const updateMemorySchema = Schema.Struct({
  memory: Schema.String,
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { memory } =
        yield* Schema.decodeUnknown(updateMemorySchema)(payload);

      const courseOps = yield* CourseOperationsService;

      yield* courseOps.updateCourseMemory({
        repoId: params.courseId!,
        memory,
      });

      return { success: true };
    }),
});
