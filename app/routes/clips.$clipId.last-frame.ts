import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { Console, Effect } from "effect";
import type { Route } from "./+types/clips.$clipId.last-frame";
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

    const seekTo = clip.sourceEndTime - 0.1;

    const videoProcessing = yield* VideoProcessingService;

    const lastFramePath = yield* videoProcessing.getLastFrame(
      inputVideo,
      seekTo
    );

    const lastFrameReadStream = createReadStream(lastFramePath);

    return new Response(lastFrameReadStream as any, {
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
