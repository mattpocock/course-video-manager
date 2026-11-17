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
 * One playback file: its loudness, and where it is on disk when it is on a
 * Storage Root and still to be measured.
 */
type PlaybackFile = {
  readonly toMeasure: string | null;
  readonly integratedLufs: number | null;
};

/**
 * The preview gain of every Clip, from the measured loudness of the file its
 * preview plays (`clipPlaybackFile`: an OBS Clip's Footage, a CVM-recorder
 * Clip's mic). Only reads: a file on no reachable Storage Root, on none at
 * all (an old Recording Session in `~/Videos`), or outside a root's
 * `raw-footage/`, keeps the unmeasured fallback and is never put up for
 * measuring.
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
      const relative = rootRelativePath(stored, roots);
      gainDbByClipId[clip.id] = previewGainDb({
        measuredLufs: playback.integratedLufs,
        imported: relative !== null && isImportedFootage(relative),
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
    // Only Footage is measured, and only where its companion may be written:
    // under a Storage Root's `raw-footage/`.
    const relative = rootRelativePath(stored, roots);
    if (
      relative === null ||
      !relative.startsWith(`${STORAGE_FOLDERS.rawFootage}/`)
    ) {
      return { toMeasure: null, integratedLufs: null };
    }
    const found = yield* resolveStoragePath(stored, roots, "Footage").pipe(
      Effect.option
    );
    if (found._tag === "None") return { toMeasure: null, integratedLufs: null };
    const loudness = yield* readPreviewLoudness(found.value).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("preview loudness: could not read", {
          file: found.value,
          error: error.message,
        })
      ),
      Effect.orElseSucceed(() => null)
    );
    return {
      toMeasure: loudness === null ? found.value : null,
      integratedLufs: loudness?.integratedLufs ?? null,
    };
  });
