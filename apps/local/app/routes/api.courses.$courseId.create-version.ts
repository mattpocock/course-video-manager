import { CoursePublishService } from "@/services/course-publish-service";
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
      const publishService = yield* CoursePublishService;

      const { version: newVersion } = yield* publishService.createDraftVersion({
        sourceVersionId: result.sourceVersionId,
        repoId: params.courseId!,
        newVersionName: result.name,
      });

      return { id: newVersion.id, name: newVersion.name };
    }),
});
