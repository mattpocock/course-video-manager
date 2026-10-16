import { useMemo, useRef } from "react";
import type { DB } from "@/db/schema";
import type {
  ClipOnDatabase,
  ChapterOnDatabase,
  DatabaseId,
  TimelineItem,
} from "@/features/video-editor/clip-state-reducer";
import { defaultInsertionPoint } from "@/features/video-editor/insert-at-point";
import {
  clipStateReducer,
  createFrontendId,
} from "@/features/video-editor/clip-state-reducer";
import type { PauseType } from "@/services/video-processing-service";
import { resolveClipZoomType } from "@/features/videos/clip-zoom";
import { useOBSConnector } from "@/features/video-editor/obs-connector";
import { OBS_PROFILE_LANDSCAPE } from "@/features/video-editor/ensure-obs-profile";
import { useSilenceLength } from "@/features/video-editor/use-silence-length";
import { useRecorderChoice } from "@/features/video-editor/use-recorder-choice";
import { useCvmRecorder } from "@/features/video-editor/use-cvm-recorder";
import { useCalibrationGate } from "@/features/video-editor/use-calibration-gate";
import { captureProps } from "@/features/video-editor/recorder-capture";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { toClipOverlay } from "@/features/video-editor/clip-overlay-row";
import { createEditEffectHandlers } from "@/features/video-editor/edit-effect-handlers";
import { obsTakeSaver } from "@/features/video-editor/obs-take-saver";
import type { TakeSaver } from "@/features/video-editor/take-saver";
import { saveClipDiagramPin } from "@/features/video-editor/save-clip-diagram-pin";
import { useClipTranscriptionJobs } from "@/features/video-editor/use-clip-transcription-jobs";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { loadAnimaticLines } from "@/services/animatic-lines.server";
import { lastPassedCalibrationNow } from "@/services/av-calibration.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { OverlayOperationsService } from "@/services/db-overlay-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { findClipsWithMissingFootage } from "@/services/clip-source-files.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { makeLoader } from "@/services/route-action.server";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { useEffectReducer } from "use-effect-reducer";
import { getActiveDiagramId } from "@/lib/diagram-window";
import { browserFocus, diagramFocus } from "@/lib/focus-tracker";
import { useBrowserLinkCapture } from "@/features/video-editor/hooks/use-browser-link-capture";
import type { Route } from "./+types/_app.videos.$videoId.edit";

export const handle = { fullscreen: true, hideParentHeader: true };
import { useNavigate, useRevalidator, useRouteLoaderData } from "react-router";
import { getBackButtonUrl } from "@/features/video-editor/video-editor-selectors";
import { anyClipsMissingTranscriptWords } from "@/features/video-editor/transcript-word-status";
import type { loader as parentLoader } from "./_app.videos.$videoId";
import { listVideoFiles, videoFilesDirectory } from "@/services/video-files";
import { sortByOrder } from "@/lib/sort-by-order";
import { createHttpClipService } from "@/services/clip-service";
import path from "node:path";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

const loadVideoEditorFsData = (opts: { lineageId: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const videoDir = videoFilesDirectory(opts.lineageId);

    const [hasExplainerFolder, dirExists] = yield* Effect.all([
      fs.exists(path.join(videoDir, "explainer")),
      fs.exists(videoDir),
    ]);

    const files: FileMetadata[] = dirExists
      ? yield* listVideoFiles(opts.lineageId)
      : [];
    const standaloneFiles: Array<{ path: string }> = files.map((f) => ({
      path: f.path,
    }));

    return { hasExplainerFolder, standaloneFiles, files };
  });

// Core data model - flat array of clips

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
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
      const overlayRows = yield* overlayOps.listOverlaysByVideoId(
        videoId,
        null
      );
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
      const {
        clips: _clips,
        chapters: _chapters,
        script,
        ...slimVideo
      } = video;
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

      const fsData = runtimeLive.runPromise(
        loadVideoEditorFsData({ lineageId: video.lineageId })
      );

      return {
        video: slimVideo,
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
    }),
});

const clipService = createHttpClipService();

export default function Component(props: Route.ComponentProps) {
  return <ComponentInner {...props} key={props.loaderData.video.id} />;
}

type ParentLoaderData = Awaited<ReturnType<typeof parentLoader>>;

export const ComponentInner = (props: Route.ComponentProps) => {
  const navigate = useNavigate();

  const parentData = useRouteLoaderData("routes/_app.videos.$videoId") as
    ParentLoaderData | undefined;

  const navigation = useMemo(() => {
    if (!parentData) return undefined;
    const breadcrumb = parentData.isStandalone
      ? parentData.videoTitle
      : `${parentData.sectionPath}/${parentData.lessonPath}/${parentData.videoTitle}`;
    return {
      backButtonUrl: getBackButtonUrl(
        parentData.repoId,
        parentData.lessonId,
        parentData.format,
        parentData.pitchId
      ),
      breadcrumb,
      nextVideoId: parentData.nextVideoId,
      previousVideoId: parentData.previousVideoId,
      showTabSwitcher: parentData.videoFormat !== "short",
      videoId: parentData.videoId,
      lessonId: parentData.lessonId,
      hasAnimatic: parentData.clipMockupCount > 0,
    };
  }, [parentData]);

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
      props.loaderData.clipIdsWithTranscriptWords as DatabaseId[]
    ),
    insertionOrder: 0,
    insertionPoint: defaultInsertionPoint(initialItems),
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    micOffsetRefusal: null,
    jobEventCursor: props.loaderData.jobEventCursor,
  };

  const clipStateRef = useRef(initialState);
  const revalidator = useRevalidator();

  const { startClipTranscription } = useUploadActions();
  // The Video's Recorder's saver. Set below, in this render, once both
  // Recorders' hooks have run: before any effect can ask for it.
  const saveTakesRef = useRef<TakeSaver | null>(null);
  const effectHandlers = useMemo(
    () =>
      createEditEffectHandlers({
        videoId: props.loaderData.video.id,
        clipService,
        clipStateRef,
        revalidate: () => revalidator.revalidate(),
        whiteNoiseAssetPath: props.loaderData.whiteNoiseAssetPath,
        saveTakes: (session, takes) => saveTakesRef.current!(session, takes),
        startClipTranscription,
      }),
    [props.loaderData.video.id, startClipTranscription]
  );

  const [clipState, dispatch] = useEffectReducer(
    clipStateReducer,
    initialState,
    effectHandlers
  );

  clipStateRef.current = clipState;

  useClipTranscriptionJobs(props.loaderData.video.id, dispatch);

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

  // Either Recorder's takes (the CVM recorder adapts: ADR 0044).
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

  const recorderChoice = useRecorderChoice(props.loaderData.video);
  const cvmRecorder = useCvmRecorder({
    video: props.loaderData.video,
    enabled: !recorderChoice.usesObs,
    silenceLength,
    clipDispatch: dispatch,
    onNewClipOptimisticallyAdded,
    onClipAudioWindowClosed,
    micOffsetRefusal: clipState.micOffsetRefusal,
  });
  const obsConnector = useOBSConnector({
    usesObs: recorderChoice.usesObs,
    clipDispatch: dispatch,
    onNewClipOptimisticallyAdded,
    onClipAudioWindowClosed,
    silenceLength,
    lastPassedCalibration: props.loaderData.lastPassedCalibration,
    // Only a Landscape Video records with OBS (ADR 0037).
    targetProfile: OBS_PROFILE_LANDSCAPE,
  });

  const obsTakes = useMemo(
    () =>
      obsTakeSaver({
        videoId: props.loaderData.video.id,
        appendFromObs: (input) => clipService.appendFromObs(input),
      }),
    [props.loaderData.video.id]
  );
  saveTakesRef.current = recorderChoice.usesObs
    ? obsTakes
    : cvmRecorder.saveTakes;

  const calibrationGate = useCalibrationGate({
    lastPassed: props.loaderData.lastPassedCalibration,
    checkedAtMs: props.loaderData.checkedAtMs,
    browserInputLabel: obsConnector.browserInputLabel,
  });

  const capture = captureProps(recorderChoice, obsConnector, cvmRecorder);

  return (
    <VideoEditor
      videoFormat={props.loaderData.video.format as "landscape" | "short"}
      anyClipsMissingTranscriptWords={anyClipsMissingTranscriptWords(clipState)}
      navigation={navigation}
      onClipsRemoved={(clipIds) => {
        dispatch({ type: "clips-deleted", clipIds: clipIds });
      }}
      onClipsRetranscribe={(clipIds) => {
        dispatch({
          type: "clips-retranscribing",
          clipIds,
          jobId: crypto.randomUUID(),
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
      onToggleZoomForClip={(clipId) => {
        dispatch({ type: "toggle-zoom-for-clip", clipId });
      }}
      onEditClipText={(clipId, text) => {
        dispatch({ type: "clip-text-edited", clipId, text });
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
      onPermanentlyRemoveArchived={(scope) => {
        dispatch(
          scope === "all"
            ? { type: "permanently-remove-all-archived" }
            : { type: "permanently-remove-archived", sessionId: scope }
        );
      }}
      obsConnectorState={obsConnector.state}
      recorderChoice={recorderChoice}
      cvmRecorder={cvmRecorder}
      calibrationGate={calibrationGate}
      items={clipState.items}
      sessions={clipState.sessions}
      repoId={props.loaderData.video.lesson?.section.repoVersion.repo.id}
      lessonId={props.loaderData.video.lesson?.id}
      videoTitle={props.loaderData.video.title}
      lessonPath={props.loaderData.video.lesson?.title}
      repoName={props.loaderData.video.lesson?.section.repoVersion.repo.name}
      videoId={props.loaderData.video.id}
      liveMediaStream={obsConnector.mediaStream}
      {...capture}
      silenceLength={silenceLength}
      onSilenceLengthChange={setSilenceLength}
      fsData={props.loaderData.fsData}
      videoCount={props.loaderData.videoCount}
      referenceCandidates={props.loaderData.referenceCandidates}
      beats={props.loaderData.beats}
      animatic={props.loaderData.animatic}
      overlays={props.loaderData.overlays}
      footageNotFound={props.loaderData.footageNotFound}
      hasScript={props.loaderData.hasScript}
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
      onAutofillChapters={async (videoId, sections) => {
        try {
          const inserted = await clipService.autofillChapters({
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
          console.error("Failed to autofill chapters", error);
          throw error;
        }
      }}
      onUpdateClipDiagramPin={(
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
