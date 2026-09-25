import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { clipMockupAssetResponse } from "@/services/clip-mockup-asset-response.server";
import { resolveClipMockupPath } from "@/services/clip-mockup-files";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { data } from "react-router";

/**
 * `/api/clip-mockups/:clipMockupId/image` and `/api/clip-mockups/:clipMockupId/audio`
 * — the only way the browser can reach a Clip Mockup's frame or its speech.
 *
 * Both halves of the noun are served by ONE route because they are the same
 * lookup: the row names a path relative to `{CLIP_MOCKUP_DIR}/{lineageId}/`,
 * and only the column differs. The client never names a path — it names a
 * Clip Mockup, and the server resolves the rest. That is what
 * `api.videos.$videoId.stream.ts` does and what `view-image.ts` (absolute path
 * straight off the query string, no guard) does not.
 *
 * Shared on purpose: the Clip Mockup list in the Video Editor (#1650) needs
 * exactly these two URLs for its thumbnails and its per-row preview.
 */

const ASSET_COLUMNS = {
  image: "imagePath",
  audio: "audioPath",
} as const;

type AssetKind = keyof typeof ASSET_COLUMNS;

const isAssetKind = (value: string | undefined): value is AssetKind =>
  value === "image" || value === "audio";

export const loader = makeLoader({
  effect: ({ request, params }) =>
    Effect.gen(function* () {
      const asset = params.asset;
      if (!isAssetKind(asset)) {
        return yield* Effect.die(
          data(`Unknown Clip Mockup asset "${asset}"`, { status: 404 })
        );
      }

      const clipMockupOps = yield* ClipMockupOperationsService;
      const videoOps = yield* VideoOperationsService;

      const mockup = yield* clipMockupOps.getClipMockupById(
        params.clipMockupId!
      );
      const relativePath = mockup[ASSET_COLUMNS[asset]];

      // `audioPath` is nullable — a row written before speech synthesis
      // existed has no voicing at all. Say so instead of streaming nothing.
      if (relativePath == null || relativePath === "") {
        return yield* Effect.die(
          data(`This Clip Mockup has no ${asset}`, { status: 404 })
        );
      }

      const video = yield* videoOps.getVideoDeepById(mockup.videoId);
      const absolutePath = yield* resolveClipMockupPath(
        video.lineageId,
        relativePath
      );

      return clipMockupAssetResponse(absolutePath, request);
    }),
  errors: { InvalidClipMockupPathError: 400 },
});
