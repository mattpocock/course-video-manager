import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFrame, clipSource } from "@/packages/clip-source";
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
          clipSource({
            ...clip,
            sceneOverride: stillSceneOverride(request.url, clip.sceneOverride),
          }),
          "first"
        ),
        yield* storageRootsConfig
      );
      const firstFramePath = yield* videoProcessing.getFirstFrame(frame);

      return new Response(webFileStream(firstFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
