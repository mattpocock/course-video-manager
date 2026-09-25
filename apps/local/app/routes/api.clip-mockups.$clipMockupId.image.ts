import { createReadStream, existsSync } from "node:fs";
import { Effect } from "effect";
import { data } from "react-router";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { resolveClipMockupPath } from "@/services/clip-mockup-files";
import { makeLoader } from "@/services/route-action.server";

/**
 * A Clip Mockup's frame, by row id: `/api/clip-mockups/:clipMockupId/image`.
 *
 * The browser is handed an ID, never a path. `imagePath` is relative to
 * `{CLIP_MOCKUP_DIR}/{video.lineageId}/` and the row is what says which Video
 * it belongs to, so the absolute path is resolved HERE — through
 * `resolveClipMockupPath`, whose containment guard is the reason no caller can
 * name a file outside the store. Modelled on
 * `api.thumbnails.$thumbnailId.image.ts`, deliberately not on `view-image.ts`
 * (which takes an absolute path from the query string and guards nothing).
 */
export const loader = makeLoader({
  errors: { InvalidClipMockupPathError: 400 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const clipMockupOps = yield* ClipMockupOperationsService;
      const videoOps = yield* VideoOperationsService;

      const row = yield* clipMockupOps.getClipMockupById(params.clipMockupId!);
      const video = yield* videoOps.getVideoDeepById(row.videoId);
      const absolute = yield* resolveClipMockupPath(
        video.lineageId,
        row.imagePath
      );

      // Checked before the stream is opened: createReadStream fails
      // asynchronously, which would otherwise surface as a truncated 200
      // rather than a 404.
      if (!existsSync(absolute)) {
        return yield* Effect.die(
          data("Clip Mockup frame not found on disk", { status: 404 })
        );
      }

      return new Response(createReadStream(absolute) as any, {
        headers: {
          "Content-Type": "image/png",
          // The frame is replaced in place by `clip-mockup update --image`
          // under a NEW filename, but the URL is the row id either way — so
          // the browser must not keep the old picture.
          "Cache-Control": "no-cache",
        },
      });
    }),
});
