import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { createReadStream } from "fs";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipById(params.clipId!);

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
    }),
});
