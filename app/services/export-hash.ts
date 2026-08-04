import crypto from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { resolveVideoFormat } from "@/features/videos/video-format";

/**
 * Bump this constant to force re-export of all videos (e.g., after changing
 * ffmpeg settings). All existing hashes become invalid.
 */
export const EXPORT_VERSION = 1;

export type ExportClip = {
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  pauseType: string;
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
  }>
): ExportClip[] =>
  clips.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
    pauseType: c.pauseType,
  }));

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
