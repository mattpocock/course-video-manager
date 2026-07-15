import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DB } from "@/db/schema";
import type {
  ClipOnDatabase,
  ChapterOnDatabase,
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "@/features/video-editor/clip-state-reducer";
import {
  clipStateReducer,
  createFrontendId,
} from "@/features/video-editor/clip-state-reducer";
import type { PauseType } from "@/services/video-processing-service";
import { useOBSConnector } from "@/features/video-editor/obs-connector";
import { useEnsureOBSProfile } from "@/features/video-editor/use-ensure-obs-profile";
import { targetProfileForFormat } from "@/features/video-editor/ensure-obs-profile";
import { useSilenceLength } from "@/features/video-editor/use-silence-length";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { createEditEffectHandlers } from "@/features/video-editor/edit-effect-handlers";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader } from "@/services/route-action.server";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { useEffectReducer } from "use-effect-reducer";
import { getActiveDiagramId } from "@/lib/diagram-window";
import { isDiagramFocused } from "@/lib/diagram-focus-tracking";
import {
  notifyBrowserFocus,
  notifyBrowserBlur,
} from "@/lib/browser-focus-tracking";
import { useAiNameShort } from "@/features/video-editor/hooks/use-ai-name-short";
import { useBrowserLinkCapture } from "@/features/video-editor/hooks/use-browser-link-capture";
import type { Route } from "./+types/_app.videos.$videoId.edit";

export const handle = { fullscreen: true };
import { useNavigate, useRevalidator } from "react-router";
import { getVideoFilePath } from "@/services/video-files";
import { Array as EffectArray } from "effect";
import { sortByOrder } from "@/lib/sort-by-order";
import { createHttpClipService } from "@/services/clip-service";
import path from "node:path";
import { DEFAULT_CHECKED_EXTENSIONS } from "@/services/text-writing-agent";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

const loadVideoEditorFsData = (opts: { lineageId: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const videoDir = getVideoFilePath(opts.lineageId);

    const [hasExplainerFolder, dirExists] = yield* Effect.all([
      fs.exists(path.join(videoDir, "explainer")),
      fs.exists(videoDir),
    ]);

    let standaloneFiles: Array<{ path: string }> = [];
    let files: FileMetadata[] = [];

    if (dirExists) {
      const filesInDirectory = yield* fs.readDirectory(videoDir);
      standaloneFiles = yield* Effect.forEach(
        filesInDirectory,
        (filename) =>
          Effect.gen(function* () {
            const filePath = getVideoFilePath(opts.lineageId, filename);
            const stat = yield* fs.stat(filePath);
            return stat.type !== "File" ? null : { path: filename };
          }),
        { concurrency: "unbounded" }
      ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));

      files = yield* Effect.forEach(
        filesInDirectory,
        (filename) =>
          Effect.gen(function* () {
            const filePath = getVideoFilePath(opts.lineageId, filename);
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

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const beatOps = yield* BeatOperationsService;
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

      const referenceCandidates = video.lesson
        ? yield* videoOps.getReferenceVideoCandidates({
            lessonId: video.lesson.id,
            excludeVideoId: video.id,
          })
        : [];

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
      const { clips: _clips, chapters: _chapters, ...slimVideo } = video;

      const whiteNoiseAssetPath = path.join(
        process.cwd(),
        "assets",
        "effects",
        "white-noise.mp4"
      );

      const fsData = runtimeLive.runPromise(
        loadVideoEditorFsData({ lineageId: video.lineageId })
      );

      return {
        video: slimVideo,
        items: sortedItems,
        waveformData: undefined,
        videoCount: lesson?.videos.length ?? 1,
        whiteNoiseAssetPath,
        fsData,
        referenceCandidates,
        beats,
      };
    }),
});

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
      item.type === "chapter-on-database" ||
      item.type === "chapter-optimistically-added"
    ) {
      const nextItem = items[i + 1];
      // Section is "empty" if the next item is another section or there's nothing after it
      const isEmpty =
        !nextItem ||
        nextItem.type === "chapter-on-database" ||
        nextItem.type === "chapter-optimistically-added";
      if (isEmpty) {
        return {
          type: "after-chapter",
          frontendChapterId: item.frontendId,
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
          pauseType: clip.pauseType as PauseType,
          diagramSnapshotId: clip.diagramSnapshotId ?? null,
          diagramName: clip.diagramSnapshot?.diagram?.name ?? null,
          webLinks: (clip.webLinks ?? []) as ClipOnDatabase["webLinks"],
        } satisfies ClipOnDatabase;
      } else {
        const chapter = item.data;
        return {
          type: "chapter-on-database",
          frontendId: createFrontendId(),
          databaseId: chapter.id,
          name: chapter.name,
          insertionOrder: null,
        } satisfies ChapterOnDatabase;
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

  const [silenceLength, setSilenceLength] = useSilenceLength();
  const silenceLengthRef = useRef(silenceLength);
  silenceLengthRef.current = silenceLength;

  // Feeds browser link-capture events from the Chrome extension into the clip
  // reducer, which folds them to the currently-visible page and accumulates the
  // set of pages shown while a clip records. Best-effort: no extension / hub
  // means no capture.
  useBrowserLinkCapture((event) => {
    dispatch({ type: "browser-event", event });
    if (event.type === "browser-focus") {
      if (event.focused) notifyBrowserFocus();
      else notifyBrowserBlur();
    }
  });

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
    silenceLength,
  });

  useEnsureOBSProfile({
    obsState: obsConnector.state,
    targetProfile: targetProfileForFormat(
      props.loaderData.video.format as "standard" | "short"
    ),
    ensureProfile: obsConnector.ensureProfile,
    onError: (message) => console.error("[OBS profile switch]", message),
  });

  useAiNameShort({
    videoId: props.loaderData.video.id,
    format: props.loaderData.video.format,
    clipState,
    onNamed: useCallback(() => revalidator.revalidate(), [revalidator]),
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
        silenceLength: silenceLengthRef.current,
      });
    } else if (prevType === "obs-recording" && currType !== "obs-recording") {
      dispatch({ type: "recording-stopped" });
    }
  }, [obsConnector.state.type]);

  return (
    <VideoEditor
      videoFormat={props.loaderData.video.format as "standard" | "short"}
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
      onTogglePause={() => {
        dispatch({ type: "toggle-pause-at-insertion-point" });
      }}
      onTogglePauseForClip={(clipId) => {
        dispatch({ type: "toggle-pause-for-clip", clipId });
      }}
      onMoveClip={(clipId, direction) => {
        dispatch({ type: "move-clip", clipId, direction });
      }}
      onAddChapter={(name) => {
        dispatch({ type: "add-chapter", name });
      }}
      onUpdateChapter={(chapterId, name) => {
        dispatch({ type: "update-chapter", chapterId, name });
      }}
      onAddChapterAt={(name, position, itemId) => {
        dispatch({ type: "add-chapter-at", name, position, itemId });
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
      videoTitle={props.loaderData.video.title}
      lessonPath={props.loaderData.video.lesson?.title}
      repoName={props.loaderData.video.lesson?.section.repoVersion.repo.name}
      videoId={props.loaderData.video.id}
      liveMediaStream={obsConnector.mediaStream}
      speechDetectorState={obsConnector.speechDetectorState}
      silenceLength={silenceLength}
      onSilenceLengthChange={setSilenceLength}
      isRecordingActive={obsConnector.state.type === "obs-recording"}
      clipIdsBeingTranscribed={clipState.clipIdsBeingTranscribed}
      fsData={props.loaderData.fsData}
      videoCount={props.loaderData.videoCount}
      referenceCandidates={props.loaderData.referenceCandidates}
      beats={props.loaderData.beats}
      onAddReferenceChapterAt={({
        videoId,
        targetItemId,
        targetItemType,
        position,
        name,
      }) => {
        clipService
          .createChapterAtPosition({
            videoId,
            name,
            position,
            targetItemId,
            targetItemType,
          })
          .then(() => revalidator.revalidate())
          .catch((error) => {
            console.error("Failed to add reference chapter", error);
          });
      }}
      onEditReferenceChapterName={(chapterId, name) => {
        clipService
          .updateChapter(chapterId, name)
          .then(() => revalidator.revalidate())
          .catch((error) => {
            console.error("Failed to edit reference chapter", error);
          });
      }}
      onDeleteReferenceChapter={(chapterId) => {
        clipService
          .archiveChapters([chapterId])
          .then(() => revalidator.revalidate())
          .catch((error) => {
            console.error("Failed to delete reference chapter", error);
          });
      }}
      onRegenerateChapters={async (videoId, sections) => {
        try {
          const inserted = await clipService.regenerateChapters({
            videoId,
            sections,
          });
          if (videoId === props.loaderData.video.id) {
            dispatch({
              type: "chapters-replaced",
              sections: inserted.map((s) => ({
                databaseId: s.id as DatabaseId,
                name: s.name,
                beforeClipDatabaseId: s.beforeClipId as DatabaseId,
              })),
            });
          }
          revalidator.revalidate();
        } catch (error) {
          console.error("Failed to regenerate chapters", error);
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
      onRemoveWebLink={(clipId, linkId) => {
        dispatch({ type: "remove-clip-web-link", clipId, linkId });
      }}
      error={clipState.error}
      onCreateVideoFromSelection={(
        frontendClipIds,
        frontendChapterIds,
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

        const chapterIds: string[] = [];
        for (const frontendId of frontendChapterIds) {
          const section = clipState.items.find(
            (c) => c.frontendId === frontendId
          );
          if (section?.type === "chapter-on-database") {
            chapterIds.push(section.databaseId as string);
          }
        }

        clipService
          .createVideoFromSelection({
            sourceVideoId: props.loaderData.video.id,
            clipIds,
            chapterIds,
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
