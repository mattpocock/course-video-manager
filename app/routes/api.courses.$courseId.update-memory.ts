import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.update-memory";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const updateMemorySchema = Schema.Struct({
  memory: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const repoId = args.params.courseId;

  return Effect.gen(function* () {
    const { memory } =
      yield* Schema.decodeUnknown(updateMemorySchema)(formDataObject);

    const courseOps = yield* CourseOperationsService;

    yield* courseOps.updateCourseMemory({ repoId, memory });

    return { success: true };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
