import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.duplicate";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";
import { FileSystem } from "@effect/platform";
import * as Path from "node:path";

const duplicateCourseSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Course name cannot be empty" })
  ),
  filePath: Schema.String.pipe(
    Schema.minLength(1, { message: () => "File path cannot be empty" })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const courseId = args.params.courseId;

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(duplicateCourseSchema)(
      formDataObject
    );

    const name = parsed.name.trim();
    const filePath = parsed.filePath.trim();

    const courseOps = yield* CourseOperationsService;

    // Get source course to validate name/path differ
    const sourceCourse = yield* courseOps.getCourseById(courseId);

    if (name === sourceCourse.name) {
      return yield* Effect.die(
        data(
          { error: "New course name must differ from the original" },
          { status: 400 }
        )
      );
    }

    if (filePath === sourceCourse.filePath) {
      return yield* Effect.die(
        data(
          { error: "New file path must differ from the original" },
          { status: 400 }
        )
      );
    }

    // Check name and file path uniqueness
    const allCourses = yield* courseOps.getCourses();
    const archivedCourses = yield* courseOps.getArchivedCourses();
    const allCoursesCombined = [...allCourses, ...archivedCourses];

    if (allCoursesCombined.some((c) => c.name === name)) {
      return yield* Effect.die(
        data(
          { error: "A course with this name already exists" },
          { status: 400 }
        )
      );
    }

    if (allCoursesCombined.some((c) => c.filePath === filePath)) {
      return yield* Effect.die(
        data(
          { error: "A course with this file path already exists" },
          { status: 400 }
        )
      );
    }

    // Validate directory exists on disk
    const fs = yield* FileSystem.FileSystem;
    const pathExists = yield* fs.exists(filePath);

    if (!pathExists) {
      return yield* Effect.die(
        data(
          { error: `Directory does not exist: ${filePath}` },
          { status: 400 }
        )
      );
    }

    // Validate directory is inside a git repository (check path and ancestors)
    let isGitRepo = false;
    let checkDir = filePath;
    while (true) {
      const gitDirPath = Path.join(checkDir, ".git");
      if (yield* fs.exists(gitDirPath)) {
        isGitRepo = true;
        break;
      }
      const parentDir = Path.dirname(checkDir);
      if (parentDir === checkDir) break; // reached filesystem root
      checkDir = parentDir;
    }

    if (!isGitRepo) {
      return yield* Effect.die(
        data(
          {
            error: `Directory is not a valid git repository: ${filePath}`,
          },
          { status: 400 }
        )
      );
    }

    const result = yield* courseOps.duplicateCourse({
      sourceCourseId: courseId,
      name,
      filePath,
    });

    return { id: result.course.id };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data({ error: "Invalid request" }, { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data({ error: "Course not found" }, { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(
        data({ error: "Internal server error" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
