import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.archive";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const archiveRepoSchema = Schema.Struct({
  archived: Schema.Literal("true", "false").pipe(
    Schema.transform(Schema.Boolean, {
      decode: (s) => s === "true",
      encode: (b) => (b ? "true" : "false") as "true" | "false",
    })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);
  const repoId = args.params.courseId;

  return Effect.gen(function* () {
    const { archived } =
      yield* Schema.decodeUnknown(archiveRepoSchema)(formDataObject);

    const courseOps = yield* CourseOperationsService;

    yield* courseOps.updateCourseArchiveStatus({ repoId, archived });

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
