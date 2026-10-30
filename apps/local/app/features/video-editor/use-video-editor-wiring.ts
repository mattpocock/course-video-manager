import { useMemo, useRef } from "react";
import { useNavigate, useRevalidator } from "react-router";
import type {
  ClipOnDatabase,
  ChapterOnDatabase,
  DatabaseId,
  TimelineItem,
} from "./clip-state-reducer";
import { clipStateReducer, createFrontendId } from "./clip-state-reducer";
import { defaultInsertionPoint } from "./insert-at-point";
import type { PauseType } from "@/services/video-processing-service";
import { resolveClipZoomType } from "@/features/videos/clip-zoom";
import { useSilenceLength } from "./use-silence-length";
import { useCvmRecorder } from "./use-cvm-recorder";
import { useCalibrationGate } from "./use-calibration-gate";
import { captureProps } from "./recorder-capture";
import { createEditEffectHandlers } from "./edit-effect-handlers";
import type { TakeSaver } from "./take-saver";
import { saveClipDiagramPin } from "./save-clip-diagram-pin";
import { useClipTranscriptionJobs } from "./use-clip-transcription-jobs";
import { anyClipsMissingTranscriptWords } from "./transcript-word-status";
import { useBrowserLinkCapture } from "./hooks/use-browser-link-capture";
import type { VideoEditorProps } from "./video-editor";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { getActiveDiagramId } from "@/lib/diagram-window";
import { browserFocus, diagramFocus } from "@/lib/focus-tracker";
import {
  createHttpClipService,
  resolveInsertionPoint,
} from "@/services/clip-service";
import type { VideoEditorLoaderData } from "@/services/video-editor-loader.server";

const clipService = createHttpClipService();

/** Everything `VideoEditor` takes but its layout. */
export type VideoEditorWiring = Omit<VideoEditorProps, "layout">;

/**
 * The video editor's wiring for one Video: the clip reducer and its effects,
 * the CVM recorder adapter (ADR 0044) with its Recording Session (ADR 0050),
 * the AV Calibration gate, speech detection and the Silence Length. Spread it
 * into `VideoEditor` and give it a layout. The edit route does; so may any
 * route that loads `loadVideoEditor`. Mount the caller with `key` set to the
 * Video's id: the reducers start from the first render's `loaderData`.
 */
export const useVideoEditorWiring = (
  loaderData: VideoEditorLoaderData
): VideoEditorWiring => {
  const navigate = useNavigate();

  const initialItems: TimelineItem[] = loaderData.items.map(
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
          zoomType: resolveClipZoomType(clip.zoomType),
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
    clipIdsWithTranscriptWords: new Set(
      loaderData.clipIdsWithTranscriptWords as DatabaseId[]
    ),
    insertionOrder: 0,
    insertionPoint: defaultInsertionPoint(initialItems),
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    micOffsetRefusal: null,
    jobEventCursor: loaderData.jobEventCursor,
  };

  const clipStateRef = useRef(initialState);
  const revalidator = useRevalidator();

  const { startClipTranscription } = useUploadActions();
  // The CVM recorder's saver. Set below, in this render, once its hook has
  // run: before any effect can ask for it.
  const saveTakesRef = useRef<TakeSaver | null>(null);
  const effectHandlers = useMemo(
    () =>
      createEditEffectHandlers({
        videoId: loaderData.video.id,
        clipService,
        clipStateRef,
        // Fire and forget: the loader's fresh data arrives as a new render.
        revalidate: () => void revalidator.revalidate(),
        whiteNoiseAssetPath: loaderData.whiteNoiseAssetPath,
        saveTakes: (session, takes) => saveTakesRef.current!(session, takes),
        startClipTranscription,
      }),
    [loaderData.video.id, startClipTranscription]
  );

  const [clipState, dispatch] = useEffectReducer(
    clipStateReducer,
    initialState,
    effectHandlers
  );

  clipStateRef.current = clipState;

  useClipTranscriptionJobs(loaderData.video.id, dispatch);

  const [silenceLength, setSilenceLength] = useSilenceLength();

  // Feeds the Chrome extension's link-capture events into the clip reducer,
  // which keeps the pages shown while a clip records. Best-effort.
  useBrowserLinkCapture((event) => {
    dispatch({ type: "browser-event", event });
    if (event.type === "browser-focus") {
      if (event.focused) browserFocus.focus();
      else browserFocus.blur();
    }
  });

  // The CVM recorder's takes (it adapts onto the clip reducer: ADR 0044).
  const onNewClipOptimisticallyAdded = (take: {
    scene: string | null;
    profile: string | null;
    soundDetectionId: string;
  }) => dispatch({ type: "new-optimistic-clip-detected", ...take });
  const onClipAudioWindowClosed = () => {
    const activeSession = clipStateRef.current.sessions.find(
      (s) => s.status === "recording"
    );
    if (!activeSession) return;
    dispatch({
      type: "clip-audio-window-closed",
      sessionId: activeSession.id,
      activeDiagramId: getActiveDiagramId(),
      diagramFocused: diagramFocus.isFocused(),
      ts: Date.now(),
    });
  };

  const cvmRecorder = useCvmRecorder({
    video: loaderData.video,
    silenceLength,
    clipDispatch: dispatch,
    onNewClipOptimisticallyAdded,
    onClipAudioWindowClosed,
    micOffsetRefusal: clipState.micOffsetRefusal,
    insertionPoint: () =>
      resolveInsertionPoint(
        clipStateRef.current.insertionPoint,
        clipStateRef.current.items
      ),
  });
  saveTakesRef.current = cvmRecorder.saveTakes;

  const calibrationGate = useCalibrationGate({
    lastPassed: loaderData.lastPassedCalibration,
    checkedAtMs: loaderData.checkedAtMs,
  });

  const capture = captureProps(cvmRecorder);

  return {
    videoFormat: loaderData.video.format as "landscape" | "short",
    anyClipsMissingTranscriptWords: anyClipsMissingTranscriptWords(clipState),
    onClipsRemoved: (clipIds) => {
      dispatch({ type: "clips-deleted", clipIds: clipIds });
    },
    onClipsRetranscribe: (clipIds) => {
      dispatch({
        type: "clips-retranscribing",
        clipIds,
        jobId: crypto.randomUUID(),
      });
    },
    insertionPoint: clipState.insertionPoint,
    onSetInsertionPoint: (mode, clipId) => {
      if (mode === "after") {
        dispatch({ type: "set-insertion-point-after", clipId });
      } else {
        dispatch({ type: "set-insertion-point-before", clipId });
      }
    },
    onDeleteLatestInsertedClip: () => {
      dispatch({ type: "delete-latest-inserted-clip" });
    },
    onTogglePause: () => {
      dispatch({ type: "toggle-pause-at-insertion-point" });
    },
    onTogglePauseForClip: (clipId) => {
      dispatch({ type: "toggle-pause-for-clip", clipId });
    },
    onToggleZoomForClip: (clipId) => {
      dispatch({ type: "toggle-zoom-for-clip", clipId });
    },
    onEditClipText: (clipId, text) => {
      dispatch({ type: "clip-text-edited", clipId, text });
    },
    onMoveClip: (clipId, direction) => {
      dispatch({ type: "move-clip", clipId, direction });
    },
    onAddChapter: (name) => {
      dispatch({ type: "add-chapter", name });
    },
    onUpdateChapter: (chapterId, name) => {
      dispatch({ type: "update-chapter", chapterId, name });
    },
    onAddChapterAt: (name, position, itemId) => {
      dispatch({ type: "add-chapter-at", name, position, itemId });
    },
    onAddEffectClipAt: (effectType, position, itemId) => {
      dispatch({ type: "add-effect-clip-at", effectType, position, itemId });
    },
    onRestoreClip: (clipId) => {
      dispatch({ type: "restore-clip", clipId });
    },
    onPermanentlyRemoveArchived: (scope) => {
      dispatch(
        scope === "all"
          ? { type: "permanently-remove-all-archived" }
          : { type: "permanently-remove-archived", sessionId: scope }
      );
    },
    cvmRecorder: cvmRecorder,
    calibrationGate: calibrationGate,
    items: clipState.items,
    sessions: clipState.sessions,
    repoId: loaderData.video.lesson?.section.repoVersion.repo.id,
    lessonId: loaderData.video.lesson?.id,
    videoTitle: loaderData.video.title,
    lessonPath: loaderData.video.lesson?.title,
    repoName: loaderData.video.lesson?.section.repoVersion.repo.name,
    videoId: loaderData.video.id,
    ...capture,
    silenceLength: silenceLength,
    onSilenceLengthChange: setSilenceLength,
    fsData: loaderData.fsData,
    previousVideoClips: loaderData.previousVideoClips,
    videoCount: loaderData.videoCount,
    referenceCandidates: loaderData.referenceCandidates,
    beats: loaderData.beats,
    animatic: loaderData.animatic,
    overlays: loaderData.overlays,
    footageNotFound: loaderData.footageNotFound,
    hasScript: loaderData.hasScript,
    onAddReferenceChapterAt: ({
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
    },
    onEditReferenceChapterName: (chapterId, name) => {
      clipService
        .updateChapter(chapterId, name)
        .then(() => revalidator.revalidate())
        .catch((error) => {
          console.error("Failed to edit reference chapter", error);
        });
    },
    onDeleteReferenceChapter: (chapterId) => {
      clipService
        .archiveChapters([chapterId])
        .then(() => revalidator.revalidate())
        .catch((error) => {
          console.error("Failed to delete reference chapter", error);
        });
    },
    onAutofillChapters: async (videoId, sections) => {
      try {
        const inserted = await clipService.autofillChapters({
          videoId,
          sections,
        });
        if (videoId === loaderData.video.id) {
          dispatch({
            type: "chapters-replaced",
            sections: inserted.map((s) => ({
              databaseId: s.id as DatabaseId,
              name: s.name,
              beforeClipDatabaseId: s.beforeClipId as DatabaseId,
            })),
          });
        }
        // Not awaited: the chapters are already in the clip reducer.
        void revalidator.revalidate();
      } catch (error) {
        console.error("Failed to autofill chapters", error);
        throw error;
      }
    },
    onUpdateClipDiagramPin: (
      clipFrontendId,
      clipDatabaseId,
      diagramSnapshotId,
      diagramName
    ) => {
      saveClipDiagramPin(clipDatabaseId, diagramSnapshotId)
        .then(() =>
          dispatch({
            type: "update-clip-diagram-pin",
            clipId: clipFrontendId,
            diagramSnapshotId,
            diagramName,
          })
        )
        .catch((error) => {
          console.error("Failed to update diagram pin", error);
        });
    },
    onRemoveWebLink: (clipId, linkId) => {
      dispatch({ type: "remove-clip-web-link", clipId, linkId });
    },
    error: clipState.error,
    onCreateVideoFromSelection: (
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
          sourceVideoId: loaderData.video.id,
          clipIds,
          chapterIds,
          title,
          mode,
        })
        .then((newVideo) => {
          // Leaving the page: nothing here waits on the navigation.
          void navigate(`/videos/${newVideo.id}/edit`);
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
    },
  };
};
