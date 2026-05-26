import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeAction } from "@/services/route-action.server";
import { FileSystem } from "@effect/platform";

class InvalidPathError extends Schema.TaggedError<InvalidPathError>()(
  "InvalidPathError",
  { message: Schema.String }
) {}

const rewritePathSchema = Schema.Struct({
  filePath: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Path cannot be empty" })
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { filePath } =
        yield* Schema.decodeUnknown(rewritePathSchema)(payload);

      const trimmedPath = filePath.trim();

      const fs = yield* FileSystem.FileSystem;
      const pathExists = yield* fs.exists(trimmedPath);

      if (!pathExists) {
        return yield* new InvalidPathError({
          message: `Path does not exist: ${trimmedPath}`,
        });
      }

      const repoId = params.courseId!;
      const courseOps = yield* CourseOperationsService;

      yield* courseOps.updateCourseFilePath({ repoId, filePath: trimmedPath });

      return { success: true };
    }).pipe(
      Effect.catchTag("InvalidPathError", (e) =>
        Effect.succeed({ success: false, error: e.message })
      ),
      Effect.catchTag("AmbiguousCourseUpdateError", (e) =>
        Effect.succeed({
          success: false,
          error: `Cannot update: ${e.repoCount} courses share path "${e.filePath}"`,
        })
      )
    ),
});
