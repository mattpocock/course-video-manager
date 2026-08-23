import crypto from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { resolveVideoFormat } from "@/features/videos/video-format";
import {
  DEFAULT_CLIP_ZOOM_TYPE,
  resolveClipZoomType,
} from "@/features/videos/clip-zoom";
import {
  DEFAULT_OVERLAY_KIND,
  resolveOverlayKind,
} from "@/features/videos/overlay-kind";

/**
 * Bump this constant to force re-export of all videos (e.g., after changing
 * ffmpeg settings). All existing hashes become invalid.
 */
export const EXPORT_VERSION = 1;

/**
 * One Overlay as the export address sees it. The Overlay's `id` is deliberately
 * absent — it is a database identity, not a rendered byte — and its `clipId` is
 * carried structurally, by which {@link ExportClip} the Overlay hangs off, so
 * re-anchoring an Overlay to another Clip still moves it in the payload and so
 * still changes the address.
 */
export type ExportOverlay = {
  at: number;
  durationInSeconds: number;
  /** The raw `kind` column; narrowed by `resolveOverlayKind` on the way in. */
  kind: string;
  /** Cut in / cut out instead of easing — see `overlay-transform.ts`. */
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
  title: string;
  description: string;
};

export type ExportClip = {
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  pauseType: string;
  zoomType: string;
  overlays: ExportOverlay[];
};

/**
 * The only `pauseType` the renderer acts on: it extends the clip by
 * LONG_PAUSE_DURATION, so it changes the exported bytes and must therefore
 * change the export address. Every other value renders identically to "none"
 * — see `createAndConcatenateVideoClipsSinglePass` in ffmpeg-commands.ts.
 */
const LONG_PAUSE = "long";

/**
 * Narrow a Clip row (which carries transcript text, ordering, archived flags…)
 * down to the fields the export address is derived from. Every caller that
 * hashes DB clips goes through here, so no site can accidentally widen or
 * narrow what the hash sees.
 */
export const toExportClips = (
  clips: ReadonlyArray<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    pauseType: string;
    zoomType: string;
    overlays: ReadonlyArray<{
      at: number;
      durationInSeconds: number;
      kind: string;
      disableEnterAnimation: boolean;
      disableExitAnimation: boolean;
      title: string;
      description: string;
    }>;
  }>
): ExportClip[] =>
  clips.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
    pauseType: c.pauseType,
    zoomType: c.zoomType,
    overlays: c.overlays.map((o) => ({
      at: o.at,
      durationInSeconds: o.durationInSeconds,
      kind: o.kind,
      disableEnterAnimation: o.disableEnterAnimation,
      disableExitAnimation: o.disableExitAnimation,
      title: o.title,
      description: o.description,
    })),
  }));

/**
 * The Overlays of one Clip, in an order the database cannot influence.
 *
 * Overlays carry no order of their own — each one is anchored to a moment, and
 * two Overlays on the same Clip render the same whichever row came back first.
 * Sorting them here keeps the address a fact about the video and not about the
 * query plan that fetched it.
 */
const toOverlayPayload = (overlays: ExportOverlay[]) =>
  overlays
    .map((o) => ({
      a: o.at,
      d: o.durationInSeconds,
      // Emitted only when it is NOT the default, exactly as `z`/`p` are below:
      // every Overlay written before `kind` existed is a Definition Card, so
      // omitting the default leaves every existing export address untouched
      // while a change of kind still moves the address.
      ...(resolveOverlayKind(o.kind) === DEFAULT_OVERLAY_KIND
        ? {}
        : { k: resolveOverlayKind(o.kind) }),
      // Same rule for the animation toggles: they change the rendered bytes,
      // so they belong in the address, but only when set. Every Overlay
      // written before the columns existed eases both ways, so omitting the
      // `false` leaves every existing export address exactly where it was.
      ...(o.disableEnterAnimation ? { ne: true } : {}),
      ...(o.disableExitAnimation ? { nx: true } : {}),
      t: o.title,
      x: o.description,
    }))
    .sort((left, right) =>
      JSON.stringify(left) < JSON.stringify(right) ? -1 : 1
    );

/**
 * Compute the content-addressed export hash for a set of clips.
 * Returns null if there are no clips (not a real video).
 *
 * Hash is deterministic: clip sequence is taken as given (callers pass clips
 * already in playback order), and only video-affecting fields are included
 * (not transcript text). Clip order therefore lives in the array itself — it is
 * never re-derived from an `order` field, so reordering a video's clips yields a
 * new hash and triggers a re-export.
 *
 * The video's `format` is part of the address because it decides the export
 * frame (landscape 16:9 vs. short 9:16): two videos with identical clips but
 * different formats produce different output files and must not collide, and
 * flipping a video's format must invalidate its existing export. The raw column
 * is normalised via {@link resolveVideoFormat} so callers can pass it straight
 * from the DB.
 *
 * A clip's Clip Zoom (`zoomType`) is part of the address for the same reason
 * `pauseType` is: the renderer crops a zoomed clip, so it changes the exported
 * bytes. It is emitted only when it is not "none", so every export made before
 * Clip Zoom existed keeps the address it already had and nothing re-renders —
 * the same reasoning that let `pauseType` be added without bumping
 * EXPORT_VERSION.
 *
 * A clip's Overlays are part of the address because the export composites them
 * onto the footage: changing a Definition Card's `title`/`description`, moving
 * its anchor, changing how long it stays up, or adding/removing one all change
 * the exported bytes. They are emitted only for a clip that actually has one,
 * so every video with no Overlays — which is every video exported before
 * Overlays existed — keeps the address it already had and nothing re-exports.
 *
 * A clip's `pauseType` is part of the address too, because a long pause makes
 * the renderer hold the clip longer and so changes the exported bytes. It is
 * emitted only when it is "long": a clip that renders exactly as it always did
 * contributes exactly what it always did, so adding this field left every
 * existing export address intact and re-exported only the videos whose address
 * had been lying about their contents.
 */
export const computeExportHash = (
  clips: ExportClip[],
  format: string | null | undefined
): string | null => {
  if (clips.length === 0) return null;

  const payload = {
    v: EXPORT_VERSION,
    fmt: resolveVideoFormat(format),
    clips: clips.map((c) => ({
      f: c.videoFilename,
      s: c.sourceStartTime,
      e: c.sourceEndTime,
      ...(c.pauseType === LONG_PAUSE ? { p: LONG_PAUSE } : {}),
      ...(resolveClipZoomType(c.zoomType) === DEFAULT_CLIP_ZOOM_TYPE
        ? {}
        : { z: resolveClipZoomType(c.zoomType) }),
      ...(c.overlays.length === 0 ? {} : { o: toOverlayPayload(c.overlays) }),
    })),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
};

/**
 * Build the filename for a content-addressed export: `{courseId}-{hash}.mp4`
 */
export const exportFilename = (courseId: string, hash: string): string =>
  `${courseId}-${hash}.mp4`;

/**
 * Resolve the absolute path where an exported video lives (or would live).
 */
export const resolveExportPath = (
  finishedVideosDir: string,
  courseId: string,
  hash: string
): string => path.join(finishedVideosDir, exportFilename(courseId, hash));

/**
 * Check whether a file with the matching export hash exists on disk.
 */
export const isExported = (
  finishedVideosDir: string,
  courseId: string,
  clips: ExportClip[],
  format: string | null | undefined
) =>
  Effect.gen(function* () {
    const hash = computeExportHash(clips, format);
    if (!hash) return false;

    const fs = yield* FileSystem.FileSystem;
    const filePath = resolveExportPath(finishedVideosDir, courseId, hash);
    return yield* fs.exists(filePath);
  });
