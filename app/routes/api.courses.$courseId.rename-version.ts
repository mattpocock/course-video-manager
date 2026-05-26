import { Effect, Schema } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeAction } from "@/services/route-action.server";

const editVersionSchema = Schema.Struct({
  versionId: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Version name cannot be empty" })
  ),
  description: Schema.optionalWith(Schema.String, { default: () => "" }),
});

export const action = makeAction({
  input: "formData",
  errors: { CannotUpdatePublishedVersionError: 400 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { versionId, name, description } =
        yield* Schema.decodeUnknown(editVersionSchema)(payload);

      const versionOps = yield* VersionOperationsService;

      yield* versionOps.updateCourseVersion({
        versionId,
        name: name.trim(),
        description: description.trim(),
      });

      return { success: true };
    }),
});
