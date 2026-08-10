import { Effect } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.videos.$videoId.export-file-exists";

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const publishService = yield* CoursePublishService;
    const exists = yield* publishService.isExported(videoId);
    return Response.json({ exists });
  }).pipe(
    Effect.catchAll(() => {
      return Effect.succeed(Response.json({ exists: false }));
    }),
    runtimeLive.runPromise
  );
};
