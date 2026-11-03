import crypto from "node:crypto";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import type { StorageRoots } from "@/packages/storage";
import { computeExportHash, toExportClips } from "./export-hash";
import {
  assertUnderFinishedVideos,
  findExportedVideo,
} from "./finished-videos.server";
import { storageRootsConfig } from "./storage-roots";

/**
 * THE SHORT EXPORT HASH: the Export Hash widened to cover what only the
 * vertical render draws. The Export Hash leaves a Clip's text out on
 * purpose (a Landscape export draws no words), but a Short burns its
 * captions in: each Clip's text, timed by its Transcript Words
 * (`short-subtitles.ts`). Everything else the vertical render draws (the
 * Clips, their order and timing, Pauses, Clip Zoom, the Chat Cards, the
 * format, the Export Version Key) is already in the Export Hash.
 *
 * The vertical render writes it beside its output, as
 * `{videoId}.mp4.export-hash`. An export with no such file, or a different
 * hash in it, is stale: the Posting Queue renders it again at its slot.
 */

type CaptionClip = {
  readonly text: string;
  readonly words: ReadonlyArray<{
    readonly start: number;
    readonly text: string;
  }>;
};

/** `{videoId}.mp4` → `{videoId}.mp4.export-hash` */
export const SHORT_EXPORT_HASH_SUFFIX = ".export-hash";

/** The Short Export Hash; null for a Short with no Clips. */
export const computeShortExportHash = (
  exportHash: string | null,
  clips: ReadonlyArray<CaptionClip>
): string | null => {
  if (exportHash === null) return null;
  const payload = {
    e: exportHash,
    c: clips.map((c) => ({
      t: c.text,
      w: c.words.map((w) => [w.start, w.text]),
    })),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
};

/** The Short Export Hash of a Short's Clips as they are now. */
export const shortExportHashOf = Effect.fn("shortExportHashOf")(function* (
  video: {
    readonly format: string | null;
    readonly clips: Parameters<typeof toExportClips>[0] &
      ReadonlyArray<{ readonly id: string; readonly text: string }>;
  },
  roots: StorageRoots
) {
  const clipOps = yield* ClipOperationsService;
  const clips = yield* Effect.forEach(video.clips, (clip) =>
    Effect.map(clipOps.listTranscriptWords(clip.id), (words) => ({
      text: clip.text,
      words,
    }))
  );
  return computeShortExportHash(
    computeExportHash(toExportClips(video.clips), video.format, roots),
    clips
  );
});

/** Write `hash` beside the vertical export at `exportPath`. */
export const writeShortExportHash = (
  roots: StorageRoots,
  exportPath: string,
  hash: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* assertUnderFinishedVideos(
      roots,
      `${exportPath}${SHORT_EXPORT_HASH_SUFFIX}`
    );
    yield* fs.writeFileString(target, hash);
  });

/**
 * Remove the hash beside the vertical export at `exportPath`, before a
 * render overwrites it: a render that fails part-way leaves no hash, so
 * its half-written file is stale.
 */
export const removeShortExportHash = (
  roots: StorageRoots,
  exportPath: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const target = yield* assertUnderFinishedVideos(
      roots,
      `${exportPath}${SHORT_EXPORT_HASH_SUFFIX}`
    );
    yield* fs.remove(target, { force: true });
  });

/**
 * Whether a Short's vertical export is stale: there is none, it has no
 * hash file (made before the Short Export Hash existed), or its hash is
 * not the Short's current one.
 */
export const isShortExportStale = Effect.fn("isShortExportStale")(function* (
  videoId: string
) {
  const fs = yield* FileSystem.FileSystem;
  const roots = yield* storageRootsConfig;
  const exported = yield* findExportedVideo(roots, `${videoId}.mp4`);
  if (Option.isNone(exported)) return true;
  const written = yield* fs
    .readFileString(`${exported.value}${SHORT_EXPORT_HASH_SUFFIX}`)
    .pipe(Effect.orElseSucceed(() => null));
  if (written === null) return true;
  const video = yield* (yield* VideoOperationsService).getVideoWithClipsById(
    videoId
  );
  const current = yield* shortExportHashOf(video, roots);
  return current === null || written.trim() !== current;
});
