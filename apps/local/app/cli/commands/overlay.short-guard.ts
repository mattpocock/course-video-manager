import { Effect } from "effect";
import { notFound, parseError } from "@/cli/helpers";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  isShortOnlyOverlayKind,
  overlayKindLabel,
  type OverlayKind,
} from "@/features/videos/overlay-kind";
import { resolveVideoFormat } from "@/features/videos/video-format";

/**
 * A Short-only Kind (a Chat Card, a Call to Action) is drawn only in a
 * Short's render, so `cvm overlay add` refuses it on any other Video. It runs
 * before the overlap guards, so the author hears the reason that matters.
 */
export const requireShortForKind = (params: {
  kind: OverlayKind;
  videoId: string;
}) =>
  Effect.gen(function* () {
    if (!isShortOnlyOverlayKind(params.kind)) return;
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(params.videoId)
      .pipe(
        Effect.catchTag("NotFoundError", () =>
          notFound("video", params.videoId)
        )
      );
    if (resolveVideoFormat(video.format) !== "short") {
      return yield* parseError(
        `Video ${params.videoId} is not a Short, and a ` +
          `${overlayKindLabel(params.kind)} is drawn only in a Short`,
        "overlay"
      );
    }
  });
