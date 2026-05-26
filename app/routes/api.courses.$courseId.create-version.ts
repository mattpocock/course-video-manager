import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeAction } from "@/services/route-action.server";
import { Effect, Schema } from "effect";

const createVersionSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  sourceVersionId: Schema.String,
});

export const action = makeAction({
  input: "formData",
  errors: { NotLatestVersionError: 400 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(createVersionSchema)(payload);
      const versionOps = yield* VersionOperationsService;

      const { version: newVersion } = yield* versionOps.copyVersionStructure({
        sourceVersionId: result.sourceVersionId,
        repoId: params.courseId!,
        newVersionName: result.name,
      });

      return { id: newVersion.id, name: newVersion.name };
    }),
});
