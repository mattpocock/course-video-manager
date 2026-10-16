import type { DB } from "@/db/schema";
import type { PauseType } from "@/services/video-processing-service";
import type { ClipZoomType } from "@/features/videos/clip-zoom";
import type { TranscriptionStatus } from "@/features/videos/transcription-status";
import type { SilenceLength } from "@/silence-detection-constants";
import type { BrowserLinkEvent, CapturedWebLink } from "@/lib/clip-web-link";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import type { ClipRecordingSession } from "@/packages/clip-source";
import type { Scene } from "@/packages/scene-layout";
import type { MicEq } from "@cvm/core/features/videos/recorder";

/**
 * The schema is typed in terms of `DatabaseId`, so it is declared in
 * `@cvm/core` beside the schema and re-exported here. `FrontendId` has no
 * database counterpart and stays.
 */
import type { DatabaseId } from "@cvm/core/db/ids";
export type { DatabaseId };

type Brand<T, B extends string> = T & { __brand: B };

export type FrontendId = Brand<string, "FrontendId">;
export type FrontendInsertionPoint =
  | {
      type: "start";
    }
  | {
      type: "after-clip";
      frontendClipId: FrontendId;
    }
  | {
      type: "after-chapter";
      frontendChapterId: FrontendId;
    }
  | {
      type: "end";
    };

export type ClipOnDatabase = {
  type: "on-database";
  frontendId: FrontendId;
  databaseId: DatabaseId;
  videoFilename: string;
  sourceStartTime: number; // Start time in source video (seconds)
  sourceEndTime: number; // End time in source video (seconds)
  text: string;
  transcribedAt: Date | null;
  /**
   * Where this Clip's Transcription stands. Loaded from the Clip, then moved
   * by the reducer as this window asks for, and hears back about,
   * Transcriptions. Read through `transcript-word-status.ts`.
   */
  transcriptionStatus: TranscriptionStatus;
  scene: string | null;
  profile: string | null;
  insertionOrder: number | null;
  pauseType: PauseType;
  /**
   * Clip Zoom. Only a persisted clip carries one — it is an editorial choice
   * about the shot, made after the take, not something a recording produces.
   */
  zoomType: ClipZoomType;
  diagramSnapshotId: string | null;
  diagramName: string | null;
  /**
   * Web pages that were on screen (focused Chrome window) while this clip was
   * recorded. Loaded from the DB for existing clips, and filled in after a
   * freshly-recorded clip's captured links are persisted.
   */
  webLinks: DB.ClipWebLink[];
  /**
   * A CVM-recorder Clip's Recording Session (files, mic offset, scene
   * timeline) and Scene Override: the Clip Source plays and stills it as the
   * composite. Absent or null on an OBS Clip.
   */
  recordingSession?: ClipRecordingSession | null;
  sceneOverride?: Scene | null;
  /**
   * If true, this clip has been archived by the user (deleted from session panel).
   * The clip stays in state so it can appear in the archived sub-section of the
   * session panel, showing its transcript text.
   */
  shouldArchive?: boolean;
  /**
   * The recording session this clip belongs to, inherited from the optimistic
   * clip it was paired with — so a clip keeps its session across both halves of
   * its life. Absent for clips loaded from the database on page load, which
   * belong to no session in this window.
   *
   * Read by the session panel, to group archived clips under the right session,
   * and by `session-clip-marks.ts`, which needs live clips too.
   */
  sessionId?: SessionId;
};

export type ClipOptimisticallyAdded = {
  type: "optimistically-added";
  frontendId: FrontendId;
  /** OBS's scene and profile, stamped on the saved Clip; null on the CVM recorder. */
  scene: string | null;
  profile: string | null;
  /**
   * An integer, incremented each time a new optimistically added clip is added.
   * Used to determine which clips should be paired with which database clips,
   * and to handle the deletion of the latest inserted clip.
   */
  insertionOrder: number;
  /**
   * If true, when the optimistically added clip is replaced with the database clip,
   * the clip will be archived. Allows the user to delete the clip before it's transcribed.
   */
  shouldArchive?: boolean;
  pauseType: PauseType;
  /**
   * Unique ID for the sound detection that triggered this clip.
   * Used for deduplication - prevents duplicate clips from React StrictMode double-firing.
   */
  soundDetectionId: string;
  /**
   * The recording session this clip belongs to.
   * Used to group optimistic clips in per-session UI panels.
   */
  sessionId: SessionId;
  /**
   * If true, this clip has been marked as orphaned — no matching DB clip
   * will arrive. Set by the session-polling-complete action after the session timeout fires.
   */
  isOrphaned?: boolean;
  /**
   * Diagram state captured when the clip's audio window closed (silence
   * detected). Decided once, at the moment the clip ends — not at DB pairing
   * time — so focus that drifts away during polling lag does not invalidate
   * the snapshot decision. Read when the optimistic clip is paired with a
   * database clip to decide whether to auto-pin a diagram snapshot.
   */
  pendingSnapshot?: {
    activeDiagramId: string | null;
    diagramFocused: boolean;
  };
  /**
   * Web links that were on screen during this clip, captured when the clip's
   * audio window closed. Read when the optimistic clip is paired with a database
   * clip, at which point they are persisted as `clip_web_link` rows.
   */
  pendingWebLinks?: CapturedWebLink[];
};

export const createFrontendId = (): FrontendId => {
  return crypto.randomUUID() as FrontendId;
};

export type ClipEffectOptimisticallyAdded = {
  type: "effect-clip-optimistically-added";
  frontendId: FrontendId;
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  text: string;
  scene: string;
  profile: string;
  pauseType: PauseType;
  insertionOrder: number;
};

export type Clip =
  ClipOnDatabase | ClipOptimisticallyAdded | ClipEffectOptimisticallyAdded;

export type ChapterOnDatabase = {
  type: "chapter-on-database";
  frontendId: FrontendId;
  databaseId: DatabaseId;
  name: string;
  insertionOrder: number | null;
};

export type ChapterOptimisticallyAdded = {
  type: "chapter-optimistically-added";
  frontendId: FrontendId;
  name: string;
  insertionOrder: number;
  shouldArchive?: boolean;
};

export type Chapter = ChapterOnDatabase | ChapterOptimisticallyAdded;

export type TimelineItem = Clip | Chapter;

export type EditorError = {
  message: string;
  effectType: string;
  timestamp: number;
};

export type MicOffsetRefusal = { clipId: FrontendId; message: string };

export type SessionId = Brand<string, "SessionId">;

export const createSessionId = (): SessionId => {
  return crypto.randomUUID() as SessionId;
};

export type RecordingSessionStatus = "recording" | "polling" | "done";

export type RecordingSession = {
  id: SessionId;
  displayNumber: number;
  status: RecordingSessionStatus;
  /** OBS's output file; a CVM recorder Recording Session's id. */
  outputPath?: string;
  startedAt: number;
  silenceLength?: SilenceLength;
  /**
   * An OBS Recording Session's silence threshold, fixed when it started: its
   * after-recording FFmpeg pass cuts with it.
   */
  silenceThresholdDb?: number;
};

/**
 * Which `transcribe-clips` Job a Clip belongs to, and whether it has started.
 * While a Job this window asked for has not started, the server may yet
 * answer that it joined another, live Job: what that other Job said about
 * the Clip in the meantime is kept (`heardBeforeJoin`) and applied on join.
 */
export type ClipTranscriptionJob = {
  jobId: string;
  started: boolean;
  heardBeforeJoin?: readonly JobEventMessage[];
};

export type ClipReducerState = {
  items: TimelineItem[];
  /**
   * The Clips known to have Transcript Words: seeded from the loader, then
   * kept up to date by every transcription that lands in this window. Read by
   * `transcript-word-status.ts`.
   */
  clipIdsWithTranscriptWords: Set<DatabaseId>;
  insertionPoint: FrontendInsertionPoint;
  insertionOrder: number;
  /**
   * When set, indicates a fatal error has occurred in the video editor.
   * The editor should display an error overlay and require a page refresh.
   */
  error: EditorError | null;
  /**
   * Recording sessions. Each session groups optimistic clips created during
   * a single recording. Session numbering resets on page reload.
   */
  sessions: RecordingSession[];
  /**
   * The `transcribe-clips` Job each Clip's latest Transcription belongs to:
   * the one this window asked for (`started: false` until its `clips-started`
   * event), or the latest one heard starting on it. Only that Job's result
   * lands on the Clip, and a Job that fails fails only the Clips it holds.
   * A Clip loaded `transcribing` belongs to the Job whose replayed
   * `clips-started` names it; one no Job holds is a Job's from before this
   * tab, and fails when one of this Video's Jobs ends without settling.
   */
  clipTranscriptionJobs: Record<DatabaseId, ClipTranscriptionJob>;
  /**
   * The newest Job Event id applied. Seeded with the one the loader read
   * before the Clips (a Clip's row is written before its event, so anything
   * at or below it is in the loaded Clips already); a Job Event at or below
   * it only says which Job holds which Clip, so a replayed one never turns a
   * newer result back.
   */
  jobEventCursor: number;
  /**
   * A mic offset the server refused because a Version that is not a Draft
   * shares its Recording Session (issue #2010): the Mic Settings dialog
   * reopens on `clipId` and says why, until dismissed.
   */
  micOffsetRefusal: MicOffsetRefusal | null;
  /**
   * Live browser link-capture state, fed by `browser-event` actions from the
   * Chrome extension. `browserFocus` + `browserUrl` fold to the single web page
   * currently visible on screen; this is ambient device state, not part of the
   * saved video document. Undefined is treated as "no focus / no URL".
   */
  browserFocus?: boolean;
  browserUrl?: string | null;
  browserTitle?: string | null;
  /**
   * The web link currently being evaluated for minimum dwell time before it
   * qualifies as a captured web link. Promoted to the recording clip's
   * `pendingWebLinks` once it has been visible for at least `WEB_LINK_DWELL_MS`.
   */
  browserLinkCandidate?: {
    url: string;
    title: string | null;
    since: number;
  } | null;
  /**
   * The optimistic clip currently being recorded (set when speech is detected,
   * cleared when its audio window closes). While set, the effective visible URL
   * from each `browser-event` is accumulated into that clip's `pendingWebLinks`.
   */
  recordingClipFrontendId?: FrontendId | null;
};

export type ClipReducerAction =
  | {
      type: "recording-started";
      outputPath: string;
      silenceLength: SilenceLength;
      /**
       * The threshold the browser detector cuts this take with, which its
       * after-recording FFmpeg pass cuts with too. Absent: the fixed default.
       */
      silenceThresholdDb?: number;
    }
  | {
      type: "recording-stopped";
    }
  | {
      type: "session-polling-complete";
      sessionId: SessionId;
    }
  | {
      type: "new-optimistic-clip-detected";
      /** OBS's scene and profile, stamped on the saved Clip; null on the CVM recorder. */
      scene: string | null;
      profile: string | null;
      soundDetectionId: string;
    }
  | {
      type: "browser-event";
      event: BrowserLinkEvent;
    }
  | {
      type: "new-database-clips";
      /** A CVM recorder Clip comes with its Recording Session, to play the composite. */
      clips: (DB.Clip & { recordingSession?: ClipRecordingSession | null })[];
      outputPath?: string;
      /** The id of the `transcribe-clips` Job the new Clips go into. */
      transcriptionJobId: string;
    }
  | {
      type: "clips-deleted";
      clipIds: FrontendId[];
    }
  | {
      type: "clips-retranscribing";
      clipIds: FrontendId[];
      /** The id the `transcribe-clips` Job will have, made by the caller. */
      jobId: string;
    }
  | {
      /**
       * The server answered this tab's request for Job `requestedJobId` with
       * the live Job `jobId`, which already transcribes the same Clips.
       */
      type: "transcription-job-joined";
      requestedJobId: string;
      jobId: string;
    }
  | {
      /** The Job Event stream said something about this Video's Clip transcriptions. */
      type: "job-event-heard";
      heard: JobEventMessage;
    }
  | {
      type: "set-insertion-point-after";
      clipId: FrontendId;
    }
  | {
      type: "set-insertion-point-before";
      clipId: FrontendId;
    }
  | {
      type: "delete-latest-inserted-clip";
    }
  | {
      type: "toggle-pause-at-insertion-point";
    }
  | {
      type: "toggle-pause-for-clip";
      clipId: FrontendId;
    }
  | {
      type: "toggle-zoom-for-clip";
      clipId: FrontendId;
    }
  | {
      /** The author saved a hand-edited text for this Clip (#2184). */
      type: "clip-text-edited";
      clipId: FrontendId;
      text: string;
    }
  | {
      type: "set-scene-override";
      clipId: FrontendId;
      sceneOverride: Scene | null;
    }
  | {
      /** The Mic Settings dialog was saved on a CVM-recorder Clip. */
      type: "mic-settings-submitted";
      clipId: FrontendId;
      micOffsetMs: number;
      micEq: MicEq;
    }
  | {
      /** Saving a mic offset failed; `effect` is the save that was sent. */
      type: "mic-offset-save-failed";
      effect: Extract<ClipReducerEffect, { type: "update-mic-offset" }>;
      message: string;
    }
  | {
      /** The Mic Settings dialog showing a refused offset was closed. */
      type: "mic-offset-refusal-dismissed";
    }
  | {
      type: "move-clip";
      clipId: FrontendId;
      direction: "up" | "down";
    }
  | {
      type: "add-chapter";
      name: string;
    }
  | {
      type: "update-chapter";
      chapterId: FrontendId;
      name: string;
    }
  | {
      type: "add-chapter-at";
      name: string;
      position: "before" | "after";
      itemId: FrontendId;
    }
  | {
      type: "chapter-created";
      frontendId: FrontendId;
      databaseId: DatabaseId;
    }
  | {
      type: "chapters-replaced";
      sections: Array<{
        databaseId: DatabaseId;
        name: string;
        beforeClipDatabaseId: DatabaseId;
      }>;
    }
  | {
      type: "restore-clip";
      clipId: FrontendId;
    }
  | {
      /** Restoring these Clips failed on the server (`unarchive-clips`). */
      type: "clip-restore-failed";
      clipIds: DatabaseId[];
      message: string;
    }
  | {
      type: "permanently-remove-archived";
      sessionId: SessionId;
    }
  | {
      type: "permanently-remove-all-archived";
    }
  | {
      type: "add-effect-clip-at";
      effectType: "white-noise";
      position: "before" | "after";
      itemId: FrontendId;
    }
  | {
      type: "effect-clip-created";
      frontendId: FrontendId;
      databaseId: DatabaseId;
    }
  | {
      type: "effect-failed";
      effectType: string;
      message: string;
    }
  | {
      type: "update-clip-diagram-pin";
      clipId: FrontendId;
      diagramSnapshotId: string | null;
      diagramName: string | null;
    }
  | {
      type: "clip-audio-window-closed";
      sessionId: SessionId;
      activeDiagramId: string | null;
      diagramFocused: boolean;
      ts: number;
    }
  | {
      type: "set-clip-web-links";
      clipId: DatabaseId;
      webLinks: DB.ClipWebLink[];
    }
  | {
      type: "remove-clip-web-link";
      clipId: FrontendId;
      linkId: DatabaseId;
    };

export type ClipReducerEffect =
  | {
      type: "transcribe-clips";
      jobId: string;
      clipIds: DatabaseId[];
    }
  | {
      type: "archive-clips";
      clipIds: DatabaseId[];
    }
  /**
   * Scrolls the timeline to the insertion point. This is the editor's only
   * viewport jump, and only the recording flow fires it, so clips stay in view
   * as they land while you narrate. Every other action deliberately leaves the
   * timeline where it is (#1483) — don't dispatch this from one.
   */
  | {
      type: "scroll-to-insertion-point";
    }
  | {
      type: "update-clips";
      clips: [
        DatabaseId,
        { scene: string; profile: string; pauseType: PauseType },
      ][];
    }
  | {
      type: "update-pause";
      clipId: DatabaseId;
      pauseType: PauseType;
    }
  | {
      type: "update-zoom";
      clipId: DatabaseId;
      zoomType: ClipZoomType;
    }
  | {
      type: "update-clip-text";
      clipId: DatabaseId;
      text: string;
    }
  | {
      type: "update-scene-override";
      clipId: DatabaseId;
      sceneOverride: Scene | null;
    }
  | {
      type: "update-mic-offset";
      clipId: DatabaseId;
      micOffsetMs: number;
      /** Echoed back on failure, to put the offset back and say why. */
      frontendClipId: FrontendId;
      recordingSessionId: string;
      previousMicOffsetMs: number;
    }
  | {
      type: "update-mic-eq";
      micEq: MicEq;
    }
  | {
      type: "reorder-clip";
      clipId: DatabaseId;
      direction: "up" | "down";
    }
  | {
      type: "reorder-chapter";
      chapterId: DatabaseId;
      direction: "up" | "down";
    }
  | {
      type: "archive-chapters";
      chapterIds: DatabaseId[];
    }
  | {
      type: "create-chapter";
      frontendId: FrontendId;
      name: string;
      insertionPoint: FrontendInsertionPoint;
    }
  | {
      type: "update-chapter";
      chapterId: DatabaseId;
      name: string;
    }
  | {
      type: "create-chapter-at";
      frontendId: FrontendId;
      name: string;
      position: "before" | "after";
      targetItemId: DatabaseId;
      targetItemType: "clip" | "chapter";
    }
  | {
      type: "create-effect-clip-at";
      frontendId: FrontendId;
      position: "before" | "after";
      targetItemId: DatabaseId;
      targetItemType: "clip" | "chapter";
      videoFilename: string;
      sourceStartTime: number;
      sourceEndTime: number;
      text: string;
      scene: string;
      profile: string;
      pauseType: string;
    }
  | {
      type: "start-session-timeout";
      sessionId: SessionId;
    }
  | {
      type: "unarchive-clips";
      clipIds: DatabaseId[];
    }
  | {
      /**
       * Save this Recording Session's Takes as Clips, through the Recorder's
       * `TakeSaver` (`take-saver.ts`), until the Session is done.
       */
      type: "save-takes";
      sessionId: SessionId;
      outputPath: string;
      silenceLength: SilenceLength;
      silenceThresholdDb?: number;
    }
  | {
      type: "revalidate-loader";
    }
  | {
      type: "snapshot-for-clip";
      diagramId: string;
      clipId: DatabaseId;
    }
  | {
      type: "persist-web-links";
      clipId: DatabaseId;
      links: CapturedWebLink[];
    }
  | {
      type: "delete-web-link";
      clipId: FrontendId;
      linkId: DatabaseId;
    };

export type ClipReducerExec = (effect: ClipReducerEffect) => void;
