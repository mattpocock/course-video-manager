import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFrame, clipSource } from "@/packages/clip-source";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { stillSceneOverride } from "@/features/video-editor/clip-still-url";
import { resolveClipFrameFiles } from "@/services/clip-source-files.server";
import { storageRootsConfig } from "@/services/storage-roots";

export const loader = makeLoader({
  errors: { StorageFileNotFoundError: 404, StillHeldError: 503 },
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipWithRecordingSession(params.clipId!);

      const videoProcessing = yield* VideoProcessingService;

      // The still's files found on a Storage Root (404 when on none).
      const frame = yield* resolveClipFrameFiles(
        clipFrame(
          clipSource(
            {
              ...clip,
              sceneOverride: stillSceneOverride(
                request.url,
                clip.sceneOverride
              ),
            },
            // Drawn as the Video draws it: a Short's in the Short layout.
            { videoFormat: resolveVideoFormat(clip.video.format) }
          ),
          "last"
        ),
        yield* storageRootsConfig
      );
      const lastFramePath = yield* videoProcessing.getLastFrame(frame);

      return new Response(webFileStream(lastFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
