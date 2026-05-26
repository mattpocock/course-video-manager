import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeAction } from "@/services/route-action.server";
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

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(duplicateCourseSchema)(
        payload
      );

      const name = parsed.name.trim();
      const filePath = parsed.filePath.trim();

      const courseOps = yield* CourseOperationsService;

      const sourceCourse = yield* courseOps.getCourseById(params.courseId!);

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

      let isGitRepo = false;
      let checkDir = filePath;
      while (true) {
        const gitDirPath = Path.join(checkDir, ".git");
        if (yield* fs.exists(gitDirPath)) {
          isGitRepo = true;
          break;
        }
        const parentDir = Path.dirname(checkDir);
        if (parentDir === checkDir) break;
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
        sourceCourseId: params.courseId!,
        name,
        filePath,
      });

      return { id: result.course.id };
    }),
});
