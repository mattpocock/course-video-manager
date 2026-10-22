import crypto from "node:crypto";
import path from "node:path";
import { resolveVideoFormat } from "@/features/videos/video-format";
import {
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
  type ClipSourceColumns,
  type ClipSourceRow,
} from "@/packages/clip-source";
import {
  DEFAULT_CLIP_ZOOM_TYPE,
  resolveClipZoomType,
} from "@/features/videos/clip-zoom";
import {
  DEFAULT_OVERLAY_KIND,
  resolveOverlayKind,
} from "@/features/videos/overlay-kind";
import {
  OVERLAY_CAMERA_VERSION,
  overlayTransform,
} from "@/features/videos/overlay-transform";
import {
  bulletPanelHashPayload,
  type BulletPanelBullet,
} from "@/features/videos/bullet-panel";
import { toRootRelative } from "@/packages/storage";

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
  /** A Bullet Panel's bullets; null for every other content-kind. */
  bullets: BulletPanelBullet[] | null;
};

/**
 * A Clip as the export address sees it. Its picture and sound are the Clip
 * Source columns, read only through `@/packages/clip-source`. Built from DB
 * rows by {@link toExportClips}, which insists the Recording Session was
 * loaded.
 */
export type ExportClip = ClipSourceRow & {
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
 *
 * Its input requires the Clip's `recordingSession` (joined with its scene
 * events — `clipRecordingSessionRelation` in core): a query that forgot it
 * would address a CVM-recorder Clip as a single file and never re-export it.
 */
export const toExportClips = (
  clips: ReadonlyArray<
    ClipSourceColumns & {
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
        bullets: BulletPanelBullet[] | null;
      }>;
    }
  >
): ExportClip[] =>
  clips.map((c) => ({
    ...clipSourceColumns(c),
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
      bullets: o.bullets,
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
      // Same rule for the animation toggles: they change the rendered bytes —
      // both the panel's own animation and the kind-derived camera Transform —
      // so they belong in the address, but only when set. Every Overlay
      // written before the columns existed eases both ways, so omitting the
      // `false` leaves every existing export address exactly where it was.
      ...(o.disableEnterAnimation ? { ne: true } : {}),
      ...(o.disableExitAnimation ? { nx: true } : {}),
      // How the camera move itself renders, carried ONLY by an Overlay whose
      // Kind has one. The move's arithmetic is not in the address — it is code,
      // not data — so a Video already exported with an older, wronger move
      // would otherwise keep those bytes for ever. Absent for a Definition
      // Card, which moves no camera, so no export that predates the Transform
      // is re-addressed by it.
      ...(overlayTransform(o.kind) ? { cv: OVERLAY_CAMERA_VERSION } : {}),
      t: o.title,
      x: o.description,
      // The Bullet Panel's bullets join `k` in being emitted only when they
      // say something: an Overlay with no bullets hashes exactly as it did
      // before the column existed, so no export written before this feature
      // is re-addressed. The bullets themselves are spelled out by
      // `bulletPanelHashPayload` — the SAME encoder the Overlay Render Cache's
      // content hash uses, so the two addresses cannot drift apart.
      ...(o.bullets && o.bullets.length > 0
        ? { b: bulletPanelHashPayload(o.bullets) }
        : {}),
    }))
    .sort((left, right) =>
      JSON.stringify(left) < JSON.stringify(right) ? -1 : 1
    );

/**
 * A Clip's Clip Source hash fields with `f` made root-relative. Overriding
 * `f` in place keeps it the first key, so the payload's key order — which the
 * address depends on — is the one `clipSourceHashFields` pins.
 */
const rootRelativeHashFields = <F extends { f: string }>(
  fields: F,
  storageRoots: readonly string[]
): F => ({ ...fields, f: toRootRelative(fields.f, storageRoots) });

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
 *
 * A CVM-recorder Clip's composite is drawn from more than its file and range:
 * its Recording Session, scene segments, Scene Override, mic offset, the
 * saved mic EQ (loaded with its Recording Session) and the layout version
 * join its entry (see
 * `clipSourceHashFields`). An OBS Clip's entry is untouched.
 *
 * The file a Clip's entry names (`f`) is its ROOT-RELATIVE path
 * (`raw-footage/x.mp4`), never the drive it is on: a legacy absolute path
 * under one of `storageRoots` is normalized first, so a row hashes the same
 * before and after the data migration rewrites it, and moving a file between
 * Storage Roots never changes an address. A path under no root (a Recording
 * Session in `~/Videos`) is hashed exactly as stored, as it always was.
 */
export const computeExportHash = (
  clips: ExportClip[],
  format: string | null | undefined,
  storageRoots: readonly string[]
): string | null => {
  if (clips.length === 0) return null;

  const payload = {
    v: EXPORT_VERSION,
    fmt: resolveVideoFormat(format),
    clips: clips.map((c) => ({
      ...rootRelativeHashFields(
        clipSourceHashFields(clipSource(c)),
        storageRoots
      ),
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
 * Bump to re-render every Exported Animatic (and only those): the frame
 * timing, gap, picture fit or audio handling of `animatic-encode-args.ts`
 * changed. The Export Version Key still re-renders them as well.
 */
export const ANIMATIC_EXPORT_VERSION = 1;

/** One Clip Mockup as the Exported Animatic's address sees it. */
export type AnimaticExportClipMockup = {
  /** The frame, relative to the Video's Clip Mockup directory. */
  readonly imagePath: string;
  /** The voice WAV, named by a hash of its line, voice and model. */
  readonly audioPath: string | null;
  /** Measured seconds of speech; null while the voice is not ready. */
  readonly durationSeconds: number | null;
};

/**
 * The Export Hash of a Video's ANIMATIC: everything that decides how it
 * renders, under the same rules as {@link computeExportHash} — the Export
 * Version Key, the format, and the inputs in playback order — so it is
 * skipped when it is already there and re-rendered when anything changes.
 *
 * A Clip Mockup is addressed by its two file NAMES and its measured length,
 * never by reading the files. Both names already change with their content:
 * a new frame is always stored under a fresh random name
 * (`newFrameFilename`), and a WAV is named by a hash of the line, voice and
 * model. The Video's `lineageId` is in it because those names are relative
 * to the lineage's own Clip Mockup directory.
 *
 * `k: "animatic"` keeps it apart from every Clips export address, so no
 * Video's Animatic can ever collide with an Exported Video. `null` for a
 * Video with no Clip Mockups.
 */
export const computeAnimaticExportHash = (input: {
  readonly lineageId: string;
  readonly format: string | null | undefined;
  readonly clipMockups: readonly AnimaticExportClipMockup[];
}): string | null => {
  if (input.clipMockups.length === 0) return null;

  const payload = {
    v: EXPORT_VERSION,
    k: "animatic",
    av: ANIMATIC_EXPORT_VERSION,
    fmt: resolveVideoFormat(input.format),
    l: input.lineageId,
    m: input.clipMockups.map((m) => ({
      i: m.imagePath,
      a: m.audioPath,
      d: m.durationSeconds,
    })),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
};

/**
 * What an Exported Animatic's name ends in. Still an `.mp4`, so it plays when
 * double-clicked; the `.animatic` before it is what tells it apart from the
 * Video's own export beside it in `finished-videos/`.
 */
export const ANIMATIC_EXPORT_SUFFIX = ".animatic.mp4";

/**
 * The filename of an Exported Animatic: `{courseId}-{hash}.animatic.mp4`,
 * namespaced exactly as {@link exportFilename} is.
 */
export const animaticExportFilename = (
  namespace: string,
  hash: string
): string => `${namespace}-${hash}${ANIMATIC_EXPORT_SUFFIX}`;

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
