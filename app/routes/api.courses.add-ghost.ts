import { Effect, Schema } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";

const addGhostCourseSchema = Schema.Struct({
  name: Schema.String,
});

export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(addGhostCourseSchema)(payload);

      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;

      const course = yield* courseOps.createGhostCourse({
        name: result.name,
      });

      yield* versionOps.createCourseVersion({
        repoId: course.id,
        name: "v1.0",
      });

      return data({
        id: course.id,
      });
    }),
});
