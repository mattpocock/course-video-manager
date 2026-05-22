import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.rename-version";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { data } from "react-router";

const editVersionSchema = Schema.Struct({
  versionId: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Version name cannot be empty" })
  ),
  description: Schema.optionalWith(Schema.String, { default: () => "" }),
});

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const { versionId, name, description } =
      yield* Schema.decodeUnknown(editVersionSchema)(formDataObject);

    const versionOps = yield* VersionOperationsService;

    yield* versionOps.updateCourseVersion({
      versionId,
      name: name.trim(),
      description: description.trim(),
    });

    return { success: true };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("CannotUpdatePublishedVersionError", () => {
      return Effect.die(
        data("Cannot update a published version", { status: 400 })
      );
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
