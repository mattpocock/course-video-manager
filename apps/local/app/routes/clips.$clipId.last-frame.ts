import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFrame, clipSource } from "@/packages/clip-source";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipWithRecordingSession(params.clipId!);

      const videoProcessing = yield* VideoProcessingService;

      const lastFramePath = yield* videoProcessing.getLastFrame(
        clipFrame(clipSource(clip), "last")
      );

      return new Response(webFileStream(lastFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
