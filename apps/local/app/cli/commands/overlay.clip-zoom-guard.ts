/**
 * The one rule that keeps a camera-moving Overlay off already-cropped footage.
 *
 * It lives beside `overlay.ts` rather than in it for the same reason
 * `overlay.help.ts` does — the command module is at its size budget — and it is
 * shaped like the guards that stayed there (`require…`, an `Effect` that either
 * returns nothing or fails with a parse error), so `add` and `update` read the
 * same whichever file a check happens to be written in.
 */

import { Effect } from "effect";
import { notFound, parseError } from "@/cli/helpers";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import type { OverlayKind } from "@/features/videos/overlay-kind";
import { overlayTransform } from "@/features/videos/overlay-transform";
import {
  DEFAULT_CLIP_ZOOM_TYPE,
  resolveClipZoomType,
} from "@/features/videos/clip-zoom";
import {
  clipExportDurationInSeconds,
  paddedClipDurationsInSeconds,
} from "@/services/export-duration-check";

/**
 * A Clip Zoom and an Overlay Transform are two crops of the same footage, and
 * nothing composes them.
 *
 * A Clip Zoom is baked into the concat pass — the Clip is already cropped by
 * the time the Overlay pass sees it — so a `bulletPanel`'s camera move would
 * land on an ALREADY tightened shot and zoom it again, well past the framing
 * either feature was tuned for. Reconciling the two is deliberately not
 * attempted (#1579): the authoring is refused instead, so the mistake is a
 * message rather than a bad render.
 *
 * The whole window is checked, not just the anchor Clip: an Overlay's duration
 * is free to outrun its Clip, so it can drift onto a zoomed Clip further down
 * the timeline. Kinds that move no camera skip this entirely.
 */
export const requireNoClipZoomUnderTransform = (params: {
  videoId: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  kind: OverlayKind | undefined;
}) =>
  Effect.gen(function* () {
    if (overlayTransform(params.kind) === null) return;

    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps
      .getVideoWithClipsById(params.videoId)
      .pipe(
        Effect.catchTag("NotFoundError", () =>
          notFound("video", params.videoId)
        )
      );

    const durations = paddedClipDurationsInSeconds(video.clips);
    let cursor = 0;
    const spans = video.clips.map((clip, index) => {
      const from = cursor;
      const duration = durations[index];
      cursor += duration ? clipExportDurationInSeconds(duration) : 0;
      return { clip, from, to: cursor };
    });

    const anchor = spans.find((span) => span.clip.id === params.clipId);
    // Not on this Video's timeline at all is somebody else's refusal to make.
    if (!anchor) return;

    const startInSeconds = anchor.from + params.at;
    const endInSeconds = startInSeconds + params.durationInSeconds;

    for (const span of spans) {
      if (!(startInSeconds < span.to && span.from < endInSeconds)) continue;
      if (resolveClipZoomType(span.clip.zoomType) === DEFAULT_CLIP_ZOOM_TYPE) {
        continue;
      }
      return yield* parseError(
        `a ${params.kind} Overlay moves the camera, and Clip ${span.clip.id} ` +
          `(${span.from}s to ${span.to}s on the Video's timeline, which this ` +
          `Overlay is on screen over) is already zoomed ` +
          `(zoomType ${JSON.stringify(span.clip.zoomType)}). The two crops ` +
          `compound rather than compose — clear that Clip's zoom, or move the ` +
          `Overlay off it.`,
        "overlay"
      );
    }
  });
