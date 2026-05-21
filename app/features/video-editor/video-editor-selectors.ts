import { formatSecondsToTimeCode } from "@/services/utils";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  Chapter,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import { calculateTextSimilarity, isClip, isChapter } from "./clip-utils";
import type { ClipComputedProps } from "./types";

export const DANGEROUS_TEXT_SIMILARITY_THRESHOLD = 40;

// ---------------------------------------------------------------------------
// Top-level selectors (from video-editor.tsx)
// ---------------------------------------------------------------------------

/**
 * Returns items for the main timeline — on-database clips and chapters.
 * Excludes all optimistic clips and any items with shouldArchive.
 */
export const getTimelineItems = (items: TimelineItem[]): TimelineItem[] => {
  return items.filter((item) => {
    if (item.type === "optimistically-added") return false;
    if (item.type === "on-database" && item.shouldArchive) return false;
    if (item.type === "chapter-optimistically-added" && item.shouldArchive) {
      return false;
    }
    return true;
  });
};

export type SessionPanelData = {
  sessionId: SessionId;
  displayNumber: number;
  isRecording: boolean;
  startedAt: number;
  pendingClips: ClipOptimisticallyAdded[];
  archivedClips: (ClipOptimisticallyAdded | ClipOnDatabase)[];
};

/**
 * Derives session panel data from sessions and items.
 * Groups pending (non-archived) optimistic clips and archived clips by session ID.
 * Includes sessions that are actively recording (even with no clips) or have
 * at least one pending or archived clip. Sorted by display number (oldest first).
 */
export const getSessionPanels = (
  items: TimelineItem[],
  sessions: RecordingSession[]
): SessionPanelData[] => {
  const pendingBySession = new Map<SessionId, ClipOptimisticallyAdded[]>();
  const archivedBySession = new Map<
    SessionId,
    (ClipOptimisticallyAdded | ClipOnDatabase)[]
  >();

  for (const item of items) {
    if (item.type === "optimistically-added") {
      if (item.shouldArchive || item.isOrphaned) {
        const clips = archivedBySession.get(item.sessionId) ?? [];
        clips.push(item);
        archivedBySession.set(item.sessionId, clips);
      } else {
        const clips = pendingBySession.get(item.sessionId) ?? [];
        clips.push(item);
        pendingBySession.set(item.sessionId, clips);
      }
    } else if (
      item.type === "on-database" &&
      item.shouldArchive &&
      item.sessionId
    ) {
      const clips = archivedBySession.get(item.sessionId) ?? [];
      clips.push(item);
      archivedBySession.set(item.sessionId, clips);
    }
  }

  return sessions
    .filter(
      (session) =>
        session.status === "recording" ||
        session.status === "polling" ||
        pendingBySession.has(session.id) ||
        archivedBySession.has(session.id)
    )
    .map((session) => ({
      sessionId: session.id,
      displayNumber: session.displayNumber,
      isRecording: session.status === "recording",
      startedAt: session.startedAt,
      pendingClips: pendingBySession.get(session.id) ?? [],
      archivedClips: archivedBySession.get(session.id) ?? [],
    }))
    .sort((a, b) => b.displayNumber - a.displayNumber);
};

export const getClips = (items: TimelineItem[]): Clip[] => {
  return items.filter(isClip);
};

export const getCurrentClipIndex = (
  clips: Clip[],
  currentClipId: FrontendId | undefined
): number => {
  return clips.findIndex((clip) => clip.frontendId === currentClipId);
};

export const getNextClip = (
  clips: Clip[],
  currentClipId: FrontendId | undefined
): Clip | undefined => {
  const index = getCurrentClipIndex(clips, currentClipId);
  return clips[index + 1];
};

export const getSelectedClipId = (
  selectedClipsSet: Set<FrontendId>
): FrontendId | undefined => {
  return Array.from(selectedClipsSet)[0];
};

export const getClipsToAggressivelyPreload = (
  currentClipId: FrontendId | undefined,
  clips: Clip[],
  selectedClipsSet: Set<FrontendId>
): FrontendId[] => {
  const nextClip = getNextClip(clips, currentClipId);
  const selectedClipId = getSelectedClipId(selectedClipsSet);

  return [currentClipId, nextClip?.frontendId, selectedClipId].filter(
    (id) => id !== undefined
  ) as FrontendId[];
};

export const getTotalDuration = (clips: Clip[]): number => {
  return clips.reduce((acc, clip) => {
    if (clip.type === "on-database") {
      return acc + (clip.sourceEndTime - clip.sourceStartTime);
    }
    return acc;
  }, 0);
};

export const getShowVideoPlayer = (
  runningState: "playing" | "paused",
  hasLiveMediaStream: boolean
): boolean => {
  if (runningState === "playing") return true;
  // When paused with no live stream, show the video player so the user
  // can see the paused frame of the clip
  if (!hasLiveMediaStream) return true;
  return false;
};

export const getShowLiveStream = (
  hasLiveMediaStream: boolean,
  runningState: "playing" | "paused"
): boolean => {
  return hasLiveMediaStream && runningState === "paused";
};

export const getShowLastFrame = (showLastFrameOfVideo: boolean): boolean => {
  return showLastFrameOfVideo;
};

export const getDatabaseClipBeforeInsertionPoint = (
  items: TimelineItem[],
  insertionPoint: FrontendInsertionPoint
): ClipOnDatabase | undefined => {
  if (insertionPoint.type === "start") {
    return undefined;
  }

  const clips = getClips(items);

  if (insertionPoint.type === "end") {
    return clips.findLast((clip) => clip.type === "on-database");
  }

  if (insertionPoint.type === "after-clip") {
    return clips.find(
      (clip) =>
        clip.frontendId === insertionPoint.frontendClipId &&
        clip.type === "on-database"
    ) as ClipOnDatabase | undefined;
  }

  if (insertionPoint.type === "after-chapter") {
    const sectionIndex = items.findIndex(
      (item) =>
        item.frontendId === insertionPoint.frontendChapterId && isChapter(item)
    );
    if (sectionIndex === -1) return undefined;

    const itemsBefore = items.slice(0, sectionIndex);
    return itemsBefore.findLast(
      (item): item is ClipOnDatabase =>
        isClip(item) && item.type === "on-database"
    );
  }

  return undefined;
};

export const getCurrentClip = (
  clips: Clip[],
  currentClipId: FrontendId | undefined
): Clip | undefined => {
  return clips.find((clip) => clip.frontendId === currentClipId);
};

export const getAllClipsHaveSilenceDetected = (clips: Clip[]): boolean => {
  return clips.every((clip) => clip.type === "on-database");
};

export const getAllClipsHaveText = (clips: Clip[]): boolean => {
  return clips.every((clip) => clip.type === "on-database" && clip.text);
};

export const getClipComputedProps = (clips: Clip[]): ClipComputedProps => {
  let timecode = 0;
  const map: ClipComputedProps = new Map();

  clips.forEach((clip, index) => {
    if (clip.type === "optimistically-added") {
      map.set(clip.frontendId, { timecode: "", nextLevenshtein: 0 });
      return;
    }

    const nextClip = clips[index + 1];

    const nextLevenshtein =
      nextClip?.type === "on-database" && nextClip?.text
        ? calculateTextSimilarity(clip.text, nextClip.text)
        : 0;

    const timecodeString = formatSecondsToTimeCode(timecode);

    const duration = clip.sourceEndTime - clip.sourceStartTime;
    timecode += duration;

    map.set(clip.frontendId, { timecode: timecodeString, nextLevenshtein });
  });

  return map;
};

export const getAreAnyClipsDangerous = (clips: Clip[]): boolean => {
  const computedProps = getClipComputedProps(clips);
  return clips.some((clip) => {
    if (clip.type !== "on-database") return false;
    const props = computedProps.get(clip.frontendId);
    return props && props.nextLevenshtein > DANGEROUS_TEXT_SIMILARITY_THRESHOLD;
  });
};

// ---------------------------------------------------------------------------
// Per-clip selectors (from clip-item.tsx)
// ---------------------------------------------------------------------------

export const getClipDuration = (clip: Clip): number | null => {
  if (clip.type === "on-database") {
    return clip.sourceEndTime - clip.sourceStartTime;
  }
  return null;
};

export const getClipPercentComplete = (
  clip: Clip,
  currentTimeInClip: number
): number => {
  const duration = getClipDuration(clip);
  return duration ? currentTimeInClip / duration : 0;
};

export const getIsClipPortrait = (clip: Clip): boolean => {
  return (
    clip.type === "on-database" &&
    (clip.profile === "TikTok" || clip.profile === "Portrait")
  );
};

export const getIsClipDangerous = (
  clip: Clip,
  clipComputedProps: ClipComputedProps
): boolean => {
  if (clip.type !== "on-database") return false;
  const props = clipComputedProps.get(clip.frontendId);
  return (
    props !== undefined &&
    props.nextLevenshtein > DANGEROUS_TEXT_SIMILARITY_THRESHOLD
  );
};

// ---------------------------------------------------------------------------
// Panel selectors (from video-player-panel.tsx)
// ---------------------------------------------------------------------------

export const getLastTranscribedClipId = (clips: Clip[]): FrontendId | null => {
  const clipsWithText = clips.filter(
    (clip) => clip.type === "on-database" && clip.text
  );
  return clipsWithText.length > 0
    ? clipsWithText[clipsWithText.length - 1]!.frontendId
    : null;
};

export const getChapters = (items: TimelineItem[]): Chapter[] => {
  return items.filter(isChapter);
};

export const getHasSections = (items: TimelineItem[]): boolean => {
  return getChapters(items).length > 0;
};

// ---------------------------------------------------------------------------
// OBS and live stream selectors (from video-player-panel.tsx)
// ---------------------------------------------------------------------------

export const getIsOBSActive = (
  obsConnectorState: OBSConnectionOuterState
): boolean => {
  return (
    obsConnectorState.type === "obs-connected" ||
    obsConnectorState.type === "obs-recording"
  );
};

export const getIsLiveStreamPortrait = (
  obsConnectorState: OBSConnectionOuterState
): boolean => {
  return (
    getIsOBSActive(obsConnectorState) &&
    obsConnectorState.type !== "obs-not-running" &&
    obsConnectorState.profile === "TikTok"
  );
};

export const getShouldShowLastFrameOverlay = (
  databaseClipToShowLastFrameOf: ClipOnDatabase | undefined,
  showLastFrame: boolean,
  _obsConnectorState: OBSConnectionOuterState
): boolean => {
  if (!databaseClipToShowLastFrameOf || !showLastFrame) {
    return false;
  }

  return true;
};

export const getBackButtonUrl = (
  repoId: string | undefined,
  lessonId: string | undefined
): string => {
  return repoId && lessonId ? `/courses/${repoId}#${lessonId}` : "/videos";
};

export const getShowCenterLine = (
  obsConnectorState: OBSConnectionOuterState
): boolean => {
  return (
    getIsOBSActive(obsConnectorState) &&
    obsConnectorState.type !== "obs-not-running" &&
    obsConnectorState.scene === "Camera"
  );
};
