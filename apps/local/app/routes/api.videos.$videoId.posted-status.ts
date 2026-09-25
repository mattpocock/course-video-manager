import { Effect } from "effect";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { getPostedPlatforms } from "@/lib/short-status";
import type { Route } from "./+types/api.videos.$videoId.posted-status";

// Returns which platforms a video has been posted to, for the posting modal's
// per-platform indicators. The platform-to-flag mapping lives in
// `@/lib/short-status`, shared with the Shorts grid.
export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const videoPostOps = yield* VideoPostOperationsService;
    const posts = yield* videoPostOps.listByVideoId(videoId);

    return Response.json(getPostedPlatforms(posts));
  }).pipe(
    Effect.catchAll(() => Effect.succeed(Response.json(getPostedPlatforms([])))),
    runtimeLive.runPromise
  );
};
