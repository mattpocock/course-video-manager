import { CoursePublishService } from "@/services/course-publish-service";
import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
});

export const action = makeAction({
  input: "formData",
  dump: false,
  errors: {
    CourseRepoDoesNotExistError: 404,
    DoesNotExistOnDbError: 400,
    NotFoundError: 404,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(publishRepoSchema)(payload);

      const publishService = yield* CoursePublishService;
      return yield* publishService.syncToDropbox(result.repoId);
    }),
});
