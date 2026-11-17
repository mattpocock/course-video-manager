import { Effect } from "effect";
import type { FileSystem } from "@effect/platform";
import {
  clipPlaybackFile,
  clipSource,
  type ClipSourceRow,
} from "@/packages/clip-source";
import {
  isImportedFootage,
  rootRelativePath,
  STORAGE_FOLDERS,
  type StorageRoots,
} from "@/packages/storage";
import { resolveStoragePath } from "@/packages/storage/server";
import { previewGainDb } from "@/features/video-editor/preview-gain";
import { footageStamp } from "./footage-cache";
import { readPreviewLoudness } from "./preview-loudness-cache";

/** What the editor's preview needs to set each Clip's volume (#2719). */
export interface PreviewGains {
  /** The gain the preview adds to each Clip, in dB, by Clip id. */
  readonly gainDbByClipId: Record<string, number>;
  /**
   * The files (absolute, on a Storage Root) the preview plays that have no
   * measurement yet, each once, in Clip order: what the
   * `measure-preview-loudness` Job is asked to measure.
   */
  readonly toMeasure: readonly string[];
}

/**
 * One playback file, as stored: its root-relative path (null on no root),
 * its loudness if measured, and where it is on disk when it is still to be
 * measured.
 */
type PlaybackFile = {
  readonly relative: string | null;
  readonly measuredLufs: number | null;
  readonly toMeasure: string | null;
};

/**
 * The preview gain of every Clip, from the measured loudness of the file its
 * preview plays (`clipPlaybackFile`: an OBS Clip's Footage, a CVM-recorder
 * Clip's mic). Only reads. These keep the unmeasured fallback and are never
 * put up for measuring: a file on no reachable Storage Root, on none at all
 * (an old Recording Session in `~/Videos`) or outside a root's
 * `raw-footage/`; a file with no mtime to tell it fresh by; and a file
 * already recorded as silent or as failing, until it changes.
 */
export const previewGainsForClips = (
  clips: readonly (ClipSourceRow & { readonly id: string })[],
  roots: StorageRoots
): Effect.Effect<PreviewGains, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const playbackFiles = new Map<string, PlaybackFile>();
    const gainDbByClipId: Record<string, number> = {};
    for (const clip of clips) {
      const stored = clipPlaybackFile(clipSource(clip));
      let playback = playbackFiles.get(stored);
      if (playback === undefined) {
        playback = yield* findPlaybackFile(stored, roots);
        playbackFiles.set(stored, playback);
      }
      gainDbByClipId[clip.id] = previewGainDb({
        measuredLufs: playback.measuredLufs,
        imported:
          playback.relative !== null && isImportedFootage(playback.relative),
      });
    }
    const toMeasure = [...playbackFiles.values()].flatMap((file) =>
      file.toMeasure === null ? [] : [file.toMeasure]
    );
    return { gainDbByClipId, toMeasure };
  });

const findPlaybackFile = (
  stored: string,
  roots: StorageRoots
): Effect.Effect<PlaybackFile, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const relative = rootRelativePath(stored, roots);
    const unmeasured: PlaybackFile = {
      relative,
      measuredLufs: null,
      toMeasure: null,
    };
    // Only Footage is measured, and only where its companion may be written:
    // under a Storage Root's `raw-footage/`.
    if (
      relative === null ||
      !relative.startsWith(`${STORAGE_FOLDERS.rawFootage}/`)
    ) {
      return unmeasured;
    }
    const found = yield* resolveStoragePath(stored, roots, "Footage").pipe(
      Effect.option
    );
    if (found._tag === "None") return unmeasured;
    const file = found.value;
    const loudness = yield* Effect.gen(function* () {
      const stamp = yield* footageStamp(file);
      // No mtime: no record of it could ever be told fresh.
      if (stamp === null) return "skip" as const;
      return yield* readPreviewLoudness(file, stamp);
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("preview loudness: could not read", {
          file,
          error: error.message,
        })
      ),
      Effect.orElseSucceed(() => "skip" as const)
    );
    if (loudness === "skip") return unmeasured;
    if (loudness === null) return { ...unmeasured, toMeasure: file };
    return {
      ...unmeasured,
      measuredLufs:
        loudness.kind === "measured" ? loudness.integratedLufs : null,
    };
  });
