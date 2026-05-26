import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeAction } from "@/services/route-action.server";

const archiveRepoSchema = Schema.Struct({
  archived: Schema.Literal("true", "false").pipe(
    Schema.transform(Schema.Boolean, {
      decode: (s) => s === "true",
      encode: (b) => (b ? "true" : "false") as "true" | "false",
    })
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { archived } =
        yield* Schema.decodeUnknown(archiveRepoSchema)(payload);

      const courseOps = yield* CourseOperationsService;

      yield* courseOps.updateCourseArchiveStatus({
        repoId: params.courseId!,
        archived,
      });

      return { success: true };
    }),
});
