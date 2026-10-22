import path from "node:path";
import { tmpdir } from "node:os";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import { resolveStoragePath } from "@/packages/storage/server";
import {
  VIDEO_FORMAT_DIMENSIONS,
  resolveVideoFormat,
} from "@/features/videos/video-format";
import { animaticExportBlocker } from "@/features/animatic/animatic-export";
import {
  ANIMATIC_FPS,
  clipMockupSpeechSeconds,
  segmentFrames,
} from "@/features/animatic/animatic-timeline";
import {
  animaticExportFilename,
  computeAnimaticExportHash,
} from "./export-hash";
import {
  assertUnderFinishedVideos,
  findExportedVideo,
} from "./finished-videos.server";
import { locateClipMockupFile } from "./clip-mockup-files";
import { clipMockupSpeechOnsetSeconds } from "./clip-mockup-speech-onset.server";
import type { AnimaticEncodeSegment } from "./animatic-encode-args";
import { isExportUnacceptablyShort } from "./export-duration-check";
import { ExportError } from "./course-publish-errors";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { makeFfmpegLogger } from "./ffmpeg-video-logger";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { removeBestEffort } from "./remove-best-effort";
import { assertUnderEffect } from "./assert-under";

/**
 * A Clip Mockup's file, found on a Storage Root. Not on any fails with the
 * Storage Root message ("Clip Mockup 4's frame not found (E: offline?)").
 */
const findClipMockupFile = (
  lineageId: string,
  relativePath: string,
  roots: StorageRoots,
  what: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // The containment guard every Clip Mockup path goes through.
    const located = yield* locateClipMockupFile(lineageId, relativePath);
    if (yield* fs.exists(located)) return located;
    return yield* resolveStoragePath(
      path.posix.join(STORAGE_FOLDERS.clipMockups, lineageId, relativePath),
      roots,
      what
    );
  });

/**
 * Render a Video's **Animatic** to a finished file in `finished-videos/`,
 * under the normal export rules: it is addressed by its own Export Hash
 * (`computeAnimaticExportHash`), named `{courseId}-{hash}.animatic.mp4`,
 * found on whichever Storage Root has it and skipped when it is there and
 * not short, written to the first root otherwise, and checked for length
 * before it takes its name — so a cut-off encode never becomes the export.
 *
 * It is NOT an Exported Video: no Publish reads it, nothing uploads it, and
 * it gets no digest sidecar. The export garbage collector removes it once no
 * Version's Animatic has its hash.
 *
 * Refuses, before any encode, an Animatic that is not finished — a voice not
 * made yet or failed, a frame not on disk — with the same words as the
 * Export button's tooltip (`animaticExportBlocker`).
 */
export const exportAnimaticToItsAddress = Effect.fn(
  "exportAnimaticToItsAddress"
)(function* (opts: {
  videoId: string;
  storageRoots: StorageRoots;
  onProgress?: (percent: number) => void;
}) {
  const { videoId } = opts;
  const roots = opts.storageRoots;
  const fs = yield* FileSystem.FileSystem;
  const videoOps = yield* VideoOperationsService;
  const clipMockupOps = yield* ClipMockupOperationsService;
  const ffmpegEncode = yield* FFmpegEncodeService;
  const ffmpegCommands = yield* FFmpegCommandsService;
  const videoEditorLogger = yield* VideoEditorLoggerService;

  const fail = (message: string, cause: unknown = null) =>
    Effect.fail(new ExportError({ message, cause }));

  const video = yield* videoOps.getVideoWithLessonById(videoId);
  const rows = yield* clipMockupOps.listClipMockupsByVideoId(videoId);
  const namespace = video.lesson?.section.repoVersion.repo.id ?? videoId;
  const format = resolveVideoFormat(video.format);

  const hash = computeAnimaticExportHash({
    lineageId: video.lineageId,
    format,
    clipMockups: rows,
  });
  const voiceBlocker = animaticExportBlocker(
    rows.map((row) => ({
      voiceStatus: row.voiceStatus,
      imageMissing: false,
      audioMissing: row.audioPath === null,
    }))
  );
  if (hash === null || voiceBlocker !== null) {
    return yield* fail(
      `Animatic of "${video.title}" cannot be exported: ${voiceBlocker ?? "it has no Clip Mockups"}`
    );
  }

  const segmentsInFrames = rows.map(
    (row) => segmentFrames(clipMockupSpeechSeconds(row)).durationInFrames
  );
  const expectedDurationInSeconds =
    segmentsInFrames.reduce((total, frames) => total + frames, 0) /
    ANIMATIC_FPS;

  // Already exported, on any root, and whole: nothing to do.
  const filename = animaticExportFilename(namespace, hash);
  const existing = yield* findExportedVideo(roots, filename);
  if (Option.isSome(existing)) {
    const durationInSeconds = yield* ffmpegCommands
      .getVideoDurationInSeconds(existing.value)
      .pipe(Effect.orElseSucceed(() => Number.NaN));
    if (
      !isExportUnacceptablyShort({
        expectedDurationInSeconds,
        actualDurationInSeconds: durationInSeconds,
      })
    ) {
      return { targetPath: existing.value, skipped: true };
    }
  }

  // Every file found BEFORE the encode, so a frame on an unplugged drive
  // fails with the Storage Root's own message rather than ffmpeg's.
  const segments: AnimaticEncodeSegment[] = yield* Effect.forEach(
    rows,
    (row, index) =>
      Effect.gen(function* () {
        const position = index + 1;
        const imageFile = yield* findClipMockupFile(
          video.lineageId,
          row.imagePath,
          roots,
          `Clip Mockup ${position}'s frame`
        );
        const audioFile = yield* findClipMockupFile(
          video.lineageId,
          row.audioPath!,
          roots,
          `Clip Mockup ${position}'s voice`
        );
        return {
          imageFile,
          audioFile,
          speechStartSeconds: yield* clipMockupSpeechOnsetSeconds(
            video.lineageId,
            row.audioPath!
          ),
          durationInFrames: segmentsInFrames[index]!,
        };
      })
  ).pipe(
    Effect.mapError(
      (error) => new ExportError({ message: error.message, cause: error })
    )
  );

  const encoded = yield* ffmpegEncode.encodeAnimatic(
    segments,
    VIDEO_FORMAT_DIMENSIONS[format],
    {
      onProgress: opts.onProgress,
      onLog: makeFfmpegLogger(videoEditorLogger, videoId, "export:animatic"),
    }
  );

  // Staged beside its address under the Video's id, as a Video export is,
  // then checked, then renamed: only a whole file ever takes the name.
  const finishedVideos = writeFolder(roots, STORAGE_FOLDERS.finishedVideos);
  const stagingPath = yield* assertUnderFinishedVideos(
    roots,
    path.join(finishedVideos, `${videoId}.animatic.mp4`)
  );
  const targetPath = yield* assertUnderFinishedVideos(
    roots,
    path.join(finishedVideos, filename)
  );
  yield* fs.makeDirectory(finishedVideos, { recursive: true });
  // Copy, not rename: the scratch file is on another device (/tmp → /mnt/d).
  yield* fs.copyFile(encoded, stagingPath);
  // The encode's own scratch file, in the OS temp dir.
  const scratch = yield* assertUnderEffect(
    path.join(tmpdir(), "video-processing"),
    encoded
  );
  yield* removeBestEffort(fs, scratch);

  const durationInSeconds = yield* ffmpegCommands
    .getVideoDurationInSeconds(stagingPath)
    .pipe(Effect.orElseSucceed(() => Number.NaN));
  if (
    isExportUnacceptablyShort({
      expectedDurationInSeconds,
      actualDurationInSeconds: durationInSeconds,
    })
  ) {
    yield* removeBestEffort(fs, stagingPath);
    return yield* fail(
      `Animatic export for "${video.title}" (${videoId}) is short: its Clip Mockups ask for ${expectedDurationInSeconds.toFixed(1)}s but the file is ${durationInSeconds.toFixed(1)}s`
    );
  }

  yield* fs.rename(stagingPath, targetPath);
  return { targetPath, skipped: false };
});
