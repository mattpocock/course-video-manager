import { Effect } from "effect";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { runtimeLive } from "@/services/layer.server";
import type { PostedPlatforms } from "@/lib/short-status";
import type { Route } from "./+types/api.videos.$videoId.posted-status";

// Returns which platforms a video has been posted to, for the posting modal's
// per-platform indicators. `youtube-shorts` posts map to YouTube; `buffer`
// posts map to TikTok.
export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const videoPostOps = yield* VideoPostOperationsService;
    const posts = yield* videoPostOps.listByVideoId(videoId);

    const posted: PostedPlatforms = {
      youtube: posts.some(
        (p) => p.platform === "youtube-shorts" && p.postedAt !== null
      ),
      tiktok: posts.some((p) => p.platform === "buffer" && p.postedAt !== null),
    };

    return Response.json(posted);
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed(Response.json({ youtube: false, tiktok: false }))
    ),
    runtimeLive.runPromise
  );
};
