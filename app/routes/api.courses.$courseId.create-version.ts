import { VersionOperationsService } from "@/services/db-version-operations.server";
import { withDatabaseDump } from "@/services/dump-service";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.courses.$courseId.create-version";
import { data } from "react-router";

const createVersionSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  sourceVersionId: Schema.String,
});

export const action = async ({ request, params }: Route.ActionArgs) => {
  const formData = await request.formData();
  const formDataObject = Object.fromEntries(formData);

  return await Effect.gen(function* () {
    const result =
      yield* Schema.decodeUnknown(createVersionSchema)(formDataObject);
    const versionOps = yield* VersionOperationsService;

    const { version: newVersion } = yield* versionOps.copyVersionStructure({
      sourceVersionId: result.sourceVersionId,
      repoId: params.courseId,
      newVersionName: result.name,
    });

    // No video file renaming needed — content-addressed naming means
    // the same clips produce the same hash and resolve to the same file.

    return { id: newVersion.id, name: newVersion.name };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () =>
      Effect.die(
        data("Invalid request - version name required", { status: 400 })
      )
    ),
    Effect.catchTag("NotLatestVersionError", () =>
      Effect.die(
        data("Can only create new version from latest version", { status: 400 })
      )
    ),
    Effect.catchAll(() =>
      Effect.die(data("Internal server error", { status: 500 }))
    ),
    runtimeLive.runPromise
  );
};
