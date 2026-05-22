import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.rewrite-path";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
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

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const repoId = args.params.courseId;

  return Effect.gen(function* () {
    const { filePath } =
      yield* Schema.decodeUnknown(rewritePathSchema)(formDataObject);

    const trimmedPath = filePath.trim();

    // Validate path exists on filesystem
    const fs = yield* FileSystem.FileSystem;
    const pathExists = yield* fs.exists(trimmedPath);

    if (!pathExists) {
      return yield* new InvalidPathError({
        message: `Path does not exist: ${trimmedPath}`,
      });
    }

    const courseOps = yield* CourseOperationsService;

    yield* courseOps.updateCourseFilePath({ repoId, filePath: trimmedPath });

    return { success: true };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("InvalidPathError", (e) => {
      return Effect.succeed({ success: false, error: e.message });
    }),
    Effect.catchTag("AmbiguousCourseUpdateError", (e) => {
      return Effect.succeed({
        success: false,
        error: `Cannot update: ${e.repoCount} courses share path "${e.filePath}"`,
      });
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
