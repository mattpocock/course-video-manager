import type { DB } from "@/db/schema";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { loadAnimaticLines } from "@/services/animatic-lines.server";
import { lastPassedCalibrationNow } from "@/services/av-calibration.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { findClipsWithMissingFootage } from "@/services/clip-source-files.server";
import {
  readStorageRootsSync,
  storageRootsConfig,
} from "@/services/storage-roots";
import { toClipOverlay } from "@/features/video-editor/clip-overlay-row";
import { listVideoFiles, videoFilesDirectory } from "@/services/video-files";
import { existsOnStorage } from "@/packages/storage/server";
import { sortByOrder } from "@/lib/sort-by-order";
import { Effect } from "effect";
import path from "node:path";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

const loadVideoEditorFsData = (opts: { lineageId: string }) =>
  Effect.gen(function* () {
    const videoDir = videoFilesDirectory(opts.lineageId);
    // On an Offline Storage Root, neither is there: the page still renders.
    const roots = readStorageRootsSync();
    const [hasExplainerFolder, dirExists] = yield* Effect.all([
      existsOnStorage(path.join(videoDir, "explainer"), roots),
      existsOnStorage(videoDir, roots),
    ]);

    const files: FileMetadata[] = dirExists
      ? yield* listVideoFiles(opts.lineageId)
      : [];
    const standaloneFiles: Array<{ path: string }> = files.map((f) => ({
      path: f.path,
    }));

    return { hasExplainerFolder, standaloneFiles, files };
  });

/**
 * Everything the video editor's wiring (`useVideoEditorWiring`) needs for one
 * Video. The edit route loads it, and so may any other route that mounts the
 * editor's context and recording wiring in a layout of its own.
 */
export const loadVideoEditor = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const beatOps = yield* BeatOperationsService;
    const clipOps = yield* ClipOperationsService;
    const overlayOps = yield* OverlayOperationsService;
    const jobOps = yield* JobOperationsService;
    // Read before the Clips: every Job Event up to here is in them (a
    // Clip's row is written before its event), so the editor applies only
    // the transcription events after it (the clip reducer's `jobEventCursor`).
    const jobEventCursor = yield* jobOps.latestJobEventId();
    const video = yield* videoOps.getVideoWithClipsById(videoId);

    // This video's own Beat plan, shown (and edited, when idle) in the
    // editor's Beat Panel. See docs/adr/0015-video-level-segment-planning.
    const beatRows = yield* beatOps.listBeatsByVideoId(videoId);
    const beats = beatRows.map((s) => ({
      id: s.id,
      videoId: s.videoId,
      kind: s.kind,
      title: s.title,
      description: s.description,
      order: s.order,
    }));

    // For the side panel's read-only Animatic tab.
    const animatic = yield* loadAnimaticLines(videoId);

    // Overlays anchored to this Video's Clips, for the in-editor overlay
    // preview (a read — the Overlay itself is authored only via `cvm
    // overlay`). `null` asks for the whole Video, not one Clip.
    const overlayRows = yield* overlayOps.listOverlaysByVideoId(videoId, null);
    const overlays = overlayRows.map(toClipOverlay);

    const referenceCandidates = video.lesson
      ? yield* videoOps.getReferenceVideoCandidates({
          lessonId: video.lesson.id,
          excludeVideoId: video.id,
        })
      : [];

    // Shown in place of the player: "Footage not found (E: offline?)".
    const footageNotFound = yield* findClipsWithMissingFootage(
      video.clips,
      yield* storageRootsConfig
    );

    const clipItems = video.clips.map((clip) => ({
      type: "clip" as const,
      order: clip.order,
      data: clip,
    }));

    const chapterItems: Array<{
      type: "chapter";
      order: string;
      data: DB.Chapter;
    }> = (video.chapters as DB.Chapter[]).map((chapter) => ({
      type: "chapter" as const,
      order: chapter.order,
      data: chapter,
    }));

    const sortedItems = sortByOrder([...clipItems, ...chapterItems]);

    const lesson = video.lesson;
    // The script itself is loaded on demand by the Script tab — the editor
    // only needs to know one exists (to enable the Copy Video modal's "Copy
    // script"), and script text can be long.
    const { clips: _clips, chapters: _chapters, script, ...slimVideo } = video;
    const hasScript = script != null && script !== "";

    // Clips transcribed before Transcript Words existed are never backfilled
    // (#1567), so the editor warns and offers a re-transcribe pass. It seeds
    // its clip state with these ids and decides the warning itself, since
    // only it knows which Clips are being transcribed right now.
    const clipIdsWithTranscriptWords =
      yield* clipOps.listClipIdsWithTranscriptWords(videoId);

    const whiteNoiseAssetPath = path.join(
      process.cwd(),
      "assets",
      "effects",
      "white-noise.mp4"
    );

    // Not yielded: the route runs it into a promise and streams the page
    // ahead of it (`VideoEditorLoaderData`).
    const fsData = loadVideoEditorFsData({ lineageId: video.lineageId });

    // The Suggestions tab's "Previous video" source: the transcripts of the
    // Video before this one in course order. Failing leaves it empty, and
    // the editor opens anyway.
    const previousVideoClips = yield* Effect.gen(function* () {
      const previousVideoId = yield* videoOps.getPreviousVideoId(video);
      if (!previousVideoId) return [];
      const previous = yield* videoOps.getVideoWithClipsById(previousVideoId);
      return previous.clips
        .map((clip) => clip.text.trim())
        .filter((text) => text.length > 0);
    }).pipe(Effect.orElseSucceed((): string[] => []));

    return {
      video: slimVideo,
      previousVideoClips,
      hasScript,
      clipIdsWithTranscriptWords,
      jobEventCursor,
      items: sortedItems,
      waveformData: undefined,
      videoCount: lesson?.videos.length ?? 1,
      whiteNoiseAssetPath,
      fsData,
      referenceCandidates,
      beats,
      animatic,
      overlays,
      footageNotFound,
      lastPassedCalibration: yield* lastPassedCalibrationNow,
      checkedAtMs: Date.now(),
    };
  });

/**
 * What a route's loader returns: `loadVideoEditor`'s data with its Video
 * Files read started, as a promise the page renders ahead of. The run belongs
 * to the route, its Effect boundary.
 */
export type VideoEditorLoaderData = Omit<
  Effect.Effect.Success<ReturnType<typeof loadVideoEditor>>,
  "fsData"
> & {
  fsData: Promise<
    Effect.Effect.Success<ReturnType<typeof loadVideoEditorFsData>>
  >;
};
