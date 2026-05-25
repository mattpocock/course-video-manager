import { CoursePublishService } from "@/services/course-publish-service";
import type { Route } from "./+types/api.courses.publish-to-dropbox";
import { ConfigProvider, Console, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
});

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const result =
      yield* Schema.decodeUnknown(publishRepoSchema)(formDataObject);

    const publishService = yield* CoursePublishService;
    return yield* publishService.syncToDropbox(result.repoId);
  }).pipe(
    Effect.tapErrorCause((e) => {
      return Console.log(e);
    }),
    Effect.catchTags({
      ParseError: (_e) => Effect.die(data("Invalid request", { status: 400 })),
      CourseRepoDoesNotExistError: () =>
        Effect.die(data("Repo path does not exist locally", { status: 404 })),
      DoesNotExistOnDbError: (e) =>
        Effect.die(
          data(
            JSON.stringify({
              message: e.message,
              type: e.type,
              path: e.path,
            }),
            { status: 400 }
          )
        ),
      NotFoundError: (e) =>
        Effect.die(data(`Not found: ${e.message}`, { status: 404 })),
    }),
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
    Effect.catchAll((_e) => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
