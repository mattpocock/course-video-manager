import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeAction } from "@/services/route-action.server";

const renameRepoSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Course name cannot be empty" })
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { name } = yield* Schema.decodeUnknown(renameRepoSchema)(payload);

      const courseOps = yield* CourseOperationsService;

      yield* courseOps.updateCourseName({
        repoId: params.courseId!,
        name: name.trim(),
      });

      return { success: true };
    }),
});
