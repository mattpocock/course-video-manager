import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipById(params.clipId!);

      const inputVideo = clip.videoFilename;

      const seekTo = clip.sourceStartTime;

      const videoProcessing = yield* VideoProcessingService;

      const firstFramePath = yield* videoProcessing.getFirstFrame(
        inputVideo,
        seekTo
      );

      return new Response(webFileStream(firstFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
