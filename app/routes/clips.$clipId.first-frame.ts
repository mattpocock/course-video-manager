import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { Console, Effect } from "effect";
import type { Route } from "./+types/clips.$clipId.first-frame";
import { runtimeLive } from "@/services/layer.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { createReadStream } from "fs";
import { data } from "react-router";

export const loader = async (args: Route.LoaderArgs) => {
  const { clipId } = args.params;
  return Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const clip = yield* clipOps.getClipById(clipId);

    const inputVideo = clip.videoFilename;

    const seekTo = clip.sourceStartTime;

    const videoProcessing = yield* VideoProcessingService;

    const firstFramePath = yield* videoProcessing.getFirstFrame(
      inputVideo,
      seekTo
    );

    const firstFrameReadStream = createReadStream(firstFramePath);

    return new Response(firstFrameReadStream as any, {
      headers: {
        "Content-Type": "image/png",
      },
    });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Clip not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
