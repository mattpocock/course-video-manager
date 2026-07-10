import crypto from "node:crypto";
import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";

/**
 * Bump this constant to force re-export of all videos (e.g., after changing
 * ffmpeg settings). All existing hashes become invalid.
 */
export const EXPORT_VERSION = 1;

export type ExportClip = {
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
};

/**
 * Compute the content-addressed export hash for a set of clips.
 * Returns null if there are no clips (not a real video).
 *
 * Hash is deterministic: clip sequence is taken as given (callers pass clips
 * already in playback order), and only video-affecting fields are included
 * (not transcript text). Clip order therefore lives in the array itself — it is
 * never re-derived from an `order` field, so reordering a video's clips yields a
 * new hash and triggers a re-export.
 */
export const computeExportHash = (clips: ExportClip[]): string | null => {
  if (clips.length === 0) return null;

  const payload = {
    v: EXPORT_VERSION,
    clips: clips.map((c) => ({
      f: c.videoFilename,
      s: c.sourceStartTime,
      e: c.sourceEndTime,
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
  clips: ExportClip[]
) =>
  Effect.gen(function* () {
    const hash = computeExportHash(clips);
    if (!hash) return false;

    const fs = yield* FileSystem.FileSystem;
    const filePath = resolveExportPath(finishedVideosDir, courseId, hash);
    return yield* fs.exists(filePath);
  });
