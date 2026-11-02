import { Effect } from "effect";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { notFound, parseError } from "@/cli/helpers";
import { clipTimelineStarts } from "@/services/clip-timeline";

// Split out of overlay.ts so that module stays under the repo's per-file token
// budget; `overlay add` and `overlay update` both ask it.

/**
 * At most ONE Overlay is ever visible at a given moment across the whole Video
 * (GLOSSARY.md, "Overlays and transitions") — no tracks, no layering.
 *
 * The comparison is on the VIDEO's timeline, not within one Clip: an Overlay's
 * duration is free to outrun its anchor Clip, so two Overlays on different
 * Clips can still be on screen together. Touching windows are fine — one
 * Overlay ending exactly where the next begins shows only ever one at a time.
 *
 * `exclude` is the Overlay being updated: it may of course overlap itself.
 */
export const requireNoOverlappingOverlay = (params: {
  videoId: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  exclude?: string;
}) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(params.videoId)
      .pipe(
        Effect.catchTag("NotFoundError", () =>
          notFound("video", params.videoId)
        )
      );

    const starts = clipTimelineStarts(video.clips);
    const anchorStart = starts.get(params.clipId);
    // An anchor that is not on this Video's timeline at all is somebody else's
    // refusal to make — requireActiveClip/requireSameVideo already made it.
    if (anchorStart === undefined) return;

    const startInSeconds = anchorStart + params.at;
    const endInSeconds = startInSeconds + params.durationInSeconds;

    const overlayOps = yield* OverlayOperationsService;
    const siblings = yield* overlayOps.listOverlaysByVideoId(
      params.videoId,
      null
    );

    for (const sibling of siblings) {
      if (sibling.id === params.exclude) continue;
      const siblingClipStart = starts.get(sibling.clipId);
      if (siblingClipStart === undefined) continue;
      const siblingStart = siblingClipStart + sibling.at;
      const siblingEnd = siblingStart + sibling.durationInSeconds;
      if (startInSeconds < siblingEnd && siblingStart < endInSeconds) {
        return yield* parseError(
          `this Overlay would be on screen from ${startInSeconds}s to ` +
            `${endInSeconds}s on the Video's timeline, where Overlay ` +
            `${sibling.id} is already showing (${siblingStart}s to ` +
            `${siblingEnd}s). At most one Overlay is visible at a time — ` +
            `move or shorten one of them, or delete ${sibling.id}.`,
          "overlay"
        );
      }
    }
  });
