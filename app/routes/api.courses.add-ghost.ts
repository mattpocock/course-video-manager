import type { Route } from "./+types/api.courses.add-ghost";
import { Console, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const addGhostCourseSchema = Schema.Struct({
  name: Schema.String,
});

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const formDataObject = Object.fromEntries(formData);

  return await Effect.gen(function* () {
    const result =
      yield* Schema.decodeUnknown(addGhostCourseSchema)(formDataObject);

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
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => {
      return Console.dir(e, { depth: null });
    }),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
