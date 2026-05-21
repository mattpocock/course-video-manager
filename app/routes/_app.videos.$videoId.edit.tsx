import { useEffect, useMemo, useRef } from "react";
import type { DB } from "@/db/schema";
import type {
  ClipOnDatabase,
  ClipSectionOnDatabase,
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "@/features/video-editor/clip-state-reducer";
import {
  clipStateReducer,
  createFrontendId,
} from "@/features/video-editor/clip-state-reducer";
import type { BeatType } from "@/services/video-processing-service";
import { useOBSConnector } from "@/features/video-editor/obs-connector";
import { usePauseLength } from "@/features/video-editor/use-pause-length";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { createEditEffectHandlers } from "@/features/video-editor/edit-effect-handlers";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import { useEffectReducer } from "use-effect-reducer";
import { getActiveDiagramId } from "@/lib/diagram-window";
import { isDiagramFocused } from "@/lib/diagram-focus-tracking";
import type { Route } from "./+types/_app.videos.$videoId.edit";

export const handle = { fullscreen: true };
import { data, useNavigate, useRevalidator } from "react-router";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { Array as EffectArray } from "effect";
import { sortByOrder } from "@/lib/sort-by-order";
import { createHttpClipService } from "@/services/clip-service";
import path from "node:path";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "@/services/text-writing-agent";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

// Deferred FS-heavy operations for the video editor
const loadVideoEditorFsData = (opts: {
  videoId: string;
  lesson: {
    path: string;
    section: {
      path: string;
      repoVersion: { repo: { filePath: string | null } };
    };
  } | null;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { videoId, lesson } = opts;
    const standaloneVideoDir = getStandaloneVideoFilePath(videoId);

    const [hasExplainerFolder, dirExists] = yield* Effect.all([
      lesson
        ? fs.exists(
            `${lesson.section.repoVersion.repo.filePath}/${lesson.section.path}/${lesson.path}/explainer`
          )
        : Effect.succeed(false),
      fs.exists(standaloneVideoDir),
    ]);

    let standaloneFiles: Array<{ path: string }> = [];

    if (dirExists) {
      const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);
      standaloneFiles = yield* Effect.forEach(
        filesInDirectory,
        (filename) =>
          Effect.gen(function* () {
            const filePath = getStandaloneVideoFilePath(videoId, filename);
            const stat = yield* fs.stat(filePath);
            return stat.type !== "File" ? null : { path: filename };
          }),
        { concurrency: "unbounded" }
      ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    }

    let files: FileMetadata[] = [];

    if (lesson) {
      const repo = lesson.section.repoVersion.repo;
      const section = lesson.section;
      const lessonPath = path.join(repo.filePath!, section.path, lesson.path);

      const allFilesInDirectory = yield* fs
        .readDirectory(lessonPath, { recursive: true })
        .pipe(
          Effect.map((filesResult) =>
            filesResult.map((file) => path.join(lessonPath, file))
          )
        );

      const filteredFiles = allFilesInDirectory.filter(
        (filePath) =>
          !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
            filePath.includes(excludedDir)
          )
      );

      files = yield* Effect.forEach(
        filteredFiles,
        (filePath) =>
          Effect.gen(function* () {
            const stat = yield* fs.stat(filePath);
            if (stat.type !== "File") return null;
            const relativePath = path.relative(lessonPath, filePath);
            const extension = path.extname(filePath).slice(1);
            const defaultEnabled =
              DEFAULT_CHECKED_EXTENSIONS.includes(extension) &&
              !DEFAULT_UNCHECKED_PATHS.some((uncheckedPath) =>
                relativePath.toLowerCase().includes(uncheckedPath.toLowerCase())
              );
            return {
              path: relativePath,
              size: Number(stat.size),
              defaultEnabled,
            };
          }),
        { concurrency: "unbounded" }
      ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    } else if (dirExists) {
      const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);
      files = yield* Effect.forEach(
        filesInDirectory,
        (filename) =>
          Effect.gen(function* () {
            const filePath = getStandaloneVideoFilePath(videoId, filename);
            const stat = yield* fs.stat(filePath);
            if (stat.type !== "File") return null;
            const extension = path.extname(filename).slice(1);
            const defaultEnabled =
              DEFAULT_CHECKED_EXTENSIONS.includes(extension);
            return { path: filename, size: Number(stat.size), defaultEnabled };
          }),
        { concurrency: "unbounded" }
      ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
    }

    return { hasExplainerFolder, standaloneFiles, files };
  });

// Core data model - flat array of clips

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const video = yield* db.getVideoWithClipsById(videoId);

    const referenceCandidates = video.lesson
      ? yield* db.getReferenceVideoCandidates({
          lessonId: video.lesson.id,
          excludeVideoId: video.id,
        })
      : [];

    // Combine clips and chapters into a unified items array, sorted by order
    const clipItems = video.clips.map((clip) => ({
      type: "clip" as const,
      order: clip.order,
      data: clip,
    }));

    const clipSectionItems: Array<{
      type: "clip-section";
      order: string;
      data: DB.ClipSection;
    }> = (video.chapters as DB.ClipSection[]).map((clipSection) => ({
      type: "clip-section" as const,
      order: clipSection.order,
      data: clipSection,
    }));

    const sortedItems = sortByOrder([...clipItems, ...clipSectionItems]);

    // Strip clips/chapters from video sent to client (already in items)
    const lesson = video.lesson;
    const { clips: _clips, chapters: _chapters, ...slimVideo } = video;

    const whiteNoiseAssetPath = path.join(
      process.cwd(),
      "assets",
      "effects",
      "white-noise.mp4"
    );

    // Deferred: FS-heavy operations streamed after initial render
    const fsData = runtimeLive.runPromise(
      loadVideoEditorFsData({ videoId, lesson })
    );

    return {
      video: slimVideo,
      items: sortedItems,
      waveformData: undefined,
      videoCount: lesson?.videos.length ?? 1,
      whiteNoiseAssetPath,
      fsData,
      referenceCandidates,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

// Create ClipService instance for all clip operations
const clipService = createHttpClipService();

/**
 * Returns the default insertion point: below the first section that has no
 * clips after it (before the next section or end of list). Falls back to "end".
 */
function getDefaultInsertionPoint(
  items: TimelineItem[]
): FrontendInsertionPoint {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (
      item.type === "clip-section-on-database" ||
      item.type === "clip-section-optimistically-added"
    ) {
      const nextItem = items[i + 1];
      // Section is "empty" if the next item is another section or there's nothing after it
      const isEmpty =
        !nextItem ||
        nextItem.type === "clip-section-on-database" ||
        nextItem.type === "clip-section-optimistically-added";
      if (isEmpty) {
        return {
          type: "after-clip-section",
          frontendClipSectionId: item.frontendId,
        };
      }
    }
  }
  return { type: "end" };
}

export default function Component(props: Route.ComponentProps) {
  return <ComponentInner {...props} key={props.loaderData.video.id} />;
}

export const ComponentInner = (props: Route.ComponentProps) => {
  const navigate = useNavigate();

  const initialItems: TimelineItem[] = props.loaderData.items.map(
    (item): TimelineItem => {
      if (item.type === "clip") {
        const clip = item.data;
        return {
          ...clip,
          type: "on-database",
          frontendId: createFrontendId(),
          databaseId: clip.id as DatabaseId,
          insertionOrder: null,
          beatType: clip.beatType as BeatType,
          diagramSnapshotId: clip.diagramSnapshotId ?? null,
          diagramName: clip.diagramSnapshot?.diagram?.name ?? null,
        } satisfies ClipOnDatabase;
      } else {
        const clipSection = item.data;
        return {
          type: "clip-section-on-database",
          frontendId: createFrontendId(),
          databaseId: clipSection.id,
          name: clipSection.name,
          insertionOrder: null,
        } satisfies ClipSectionOnDatabase;
      }
    }
  );

  const initialState: clipStateReducer.State = {
    items: initialItems,
    clipIdsBeingTranscribed: new Set() satisfies Set<FrontendId>,
    insertionOrder: 0,
    insertionPoint: getDefaultInsertionPoint(initialItems),
    error: null,
    sessions: [],
  };

  const clipStateRef = useRef(initialState);
  const revalidator = useRevalidator();

  const effectHandlers = useMemo(
    () =>
      createEditEffectHandlers({
        videoId: props.loaderData.video.id,
        clipService,
        clipStateRef,
        revalidate: () => revalidator.revalidate(),
        whiteNoiseAssetPath: props.loaderData.whiteNoiseAssetPath,
      }),
    [props.loaderData.video.id]
  );

  const [clipState, dispatch] = useEffectReducer(
    clipStateReducer,
    initialState,
    effectHandlers
  );

  clipStateRef.current = clipState;

  const [pauseLength, setPauseLength] = usePauseLength();
  const pauseLengthRef = useRef(pauseLength);
  pauseLengthRef.current = pauseLength;

  const obsConnector = useOBSConnector({
    onNewClipOptimisticallyAdded: ({ scene, profile, soundDetectionId }) => {
      dispatch({
        type: "new-optimistic-clip-detected",
        scene,
        profile,
        soundDetectionId,
      });
    },
    onClipAudioWindowClosed: () => {
      const activeSession = clipStateRef.current.sessions.find(
        (s) => s.status === "recording"
      );
      if (!activeSession) return;
      dispatch({
        type: "clip-audio-window-closed",
        sessionId: activeSession.id,
        activeDiagramId: getActiveDiagramId(),
        diagramFocused: isDiagramFocused(),
      });
    },
    pauseLength,
  });

  // Sync OBS recording state to clip-state-reducer sessions
  const prevOBSStateTypeRef = useRef(obsConnector.state.type);
  useEffect(() => {
    const prevType = prevOBSStateTypeRef.current;
    const currType = obsConnector.state.type;
    prevOBSStateTypeRef.current = currType;

    if (prevType !== "obs-recording" && currType === "obs-recording") {
      dispatch({
        type: "recording-started",
        outputPath:
          obsConnector.state.type === "obs-recording"
            ? obsConnector.state.latestOutputPath
            : "",
        pauseLength: pauseLengthRef.current,
      });
    } else if (prevType === "obs-recording" && currType !== "obs-recording") {
      dispatch({ type: "recording-stopped" });
    }
  }, [obsConnector.state.type]);

  return (
    <VideoEditor
      onClipsRemoved={(clipIds) => {
        dispatch({ type: "clips-deleted", clipIds: clipIds });
      }}
      onClipsRetranscribe={(clipIds) => {
        dispatch({ type: "clips-retranscribing", clipIds });

        const databaseIds = clipIds
          .map((frontendId) => {
            const clip = clipState.items.find(
              (c) => c.frontendId === frontendId
            );
            return clip?.type === "on-database" ? clip.databaseId : null;
          })
          .filter((id): id is DatabaseId => id !== null);

        fetch("/clips/transcribe", {
          method: "POST",
          body: JSON.stringify({ clipIds: databaseIds }),
        })
          .then((res) => {
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return res.json();
          })
          .then((clips: DB.Clip[]) => {
            dispatch({
              type: "clips-transcribed",
              clips: clips.map((clip) => ({
                databaseId: clip.id,
                text: clip.text,
              })),
            });
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "transcribe-clips",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to transcribe clips",
            });
          });
      }}
      insertionPoint={clipState.insertionPoint}
      onSetInsertionPoint={(mode, clipId) => {
        if (mode === "after") {
          dispatch({ type: "set-insertion-point-after", clipId });
        } else {
          dispatch({ type: "set-insertion-point-before", clipId });
        }
      }}
      onDeleteLatestInsertedClip={() => {
        dispatch({ type: "delete-latest-inserted-clip" });
      }}
      onToggleBeat={() => {
        dispatch({ type: "toggle-beat-at-insertion-point" });
      }}
      onToggleBeatForClip={(clipId) => {
        dispatch({ type: "toggle-beat-for-clip", clipId });
      }}
      onMoveClip={(clipId, direction) => {
        dispatch({ type: "move-clip", clipId, direction });
      }}
      onAddClipSection={(name) => {
        dispatch({ type: "add-clip-section", name });
      }}
      onUpdateClipSection={(clipSectionId, name) => {
        dispatch({ type: "update-clip-section", clipSectionId, name });
      }}
      onAddClipSectionAt={(name, position, itemId) => {
        dispatch({ type: "add-clip-section-at", name, position, itemId });
      }}
      onAddEffectClipAt={(effectType, position, itemId) => {
        dispatch({ type: "add-effect-clip-at", effectType, position, itemId });
      }}
      onRestoreClip={(clipId) => {
        dispatch({ type: "restore-clip", clipId });
      }}
      onPermanentlyRemoveArchived={(sessionId) => {
        dispatch({ type: "permanently-remove-archived", sessionId });
      }}
      onClearAllArchived={() => {
        dispatch({ type: "permanently-remove-all-archived" });
      }}
      obsConnectorState={obsConnector.state}
      items={clipState.items}
      sessions={clipState.sessions}
      repoId={props.loaderData.video.lesson?.section.repoVersion.repo.id}
      lessonId={props.loaderData.video.lesson?.id}
      videoPath={props.loaderData.video.path}
      lessonPath={props.loaderData.video.lesson?.path}
      repoName={props.loaderData.video.lesson?.section.repoVersion.repo.name}
      videoId={props.loaderData.video.id}
      liveMediaStream={obsConnector.mediaStream}
      speechDetectorState={obsConnector.speechDetectorState}
      pauseLength={pauseLength}
      onPauseLengthChange={setPauseLength}
      isRecordingActive={obsConnector.state.type === "obs-recording"}
      clipIdsBeingTranscribed={clipState.clipIdsBeingTranscribed}
      fsData={props.loaderData.fsData}
      videoCount={props.loaderData.videoCount}
      referenceCandidates={props.loaderData.referenceCandidates}
      onAddReferenceClipSectionAt={({
        videoId,
        targetItemId,
        targetItemType,
        position,
        name,
      }) => {
        clipService
          .createClipSectionAtPosition({
            videoId,
            name,
            position,
            targetItemId,
            targetItemType,
          })
          .then(() => revalidator.revalidate())
          .catch((error) => {
            console.error("Failed to add reference clip section", error);
          });
      }}
      onEditReferenceClipSectionName={(clipSectionId, name) => {
        clipService
          .updateClipSection(clipSectionId, name)
          .then(() => revalidator.revalidate())
          .catch((error) => {
            console.error("Failed to edit reference clip section", error);
          });
      }}
      onDeleteReferenceClipSection={(clipSectionId) => {
        clipService
          .archiveClipSections([clipSectionId])
          .then(() => revalidator.revalidate())
          .catch((error) => {
            console.error("Failed to delete reference clip section", error);
          });
      }}
      onRegenerateClipSections={async (videoId, sections) => {
        try {
          const inserted = await clipService.regenerateClipSections({
            videoId,
            sections,
          });
          if (videoId === props.loaderData.video.id) {
            dispatch({
              type: "clip-sections-replaced",
              sections: inserted.map((s) => ({
                databaseId: s.id as DatabaseId,
                name: s.name,
                beforeClipDatabaseId: s.beforeClipId as DatabaseId,
              })),
            });
          }
          revalidator.revalidate();
        } catch (error) {
          console.error("Failed to regenerate clip sections", error);
          throw error;
        }
      }}
      onUpdateClipDiagramPin={(
        clipFrontendId,
        clipDatabaseId,
        diagramSnapshotId,
        diagramName
      ) => {
        fetch(`/api/clips/${clipDatabaseId}/diagram-pin`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diagramSnapshotId }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            dispatch({
              type: "update-clip-diagram-pin",
              clipId: clipFrontendId,
              diagramSnapshotId,
              diagramName,
            });
          })
          .catch((error) => {
            console.error("Failed to update diagram pin", error);
          });
      }}
      error={clipState.error}
      onCreateVideoFromSelection={(
        frontendClipIds,
        frontendClipSectionIds,
        title,
        mode
      ) => {
        // Map frontend IDs to database IDs (cast to string for ClipService)
        const clipIds: string[] = [];
        for (const frontendId of frontendClipIds) {
          const clip = clipState.items.find((c) => c.frontendId === frontendId);
          if (clip?.type === "on-database") {
            clipIds.push(clip.databaseId as string);
          }
        }

        const clipSectionIds: string[] = [];
        for (const frontendId of frontendClipSectionIds) {
          const section = clipState.items.find(
            (c) => c.frontendId === frontendId
          );
          if (section?.type === "clip-section-on-database") {
            clipSectionIds.push(section.databaseId as string);
          }
        }

        clipService
          .createVideoFromSelection({
            sourceVideoId: props.loaderData.video.id,
            clipIds,
            clipSectionIds,
            title,
            mode,
          })
          .then((newVideo) => {
            navigate(`/videos/${newVideo.id}/edit`);
          })
          .catch((error) => {
            dispatch({
              type: "effect-failed",
              effectType: "create-video-from-selection",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to create video from selection",
            });
          });
      }}
    />
  );
};
