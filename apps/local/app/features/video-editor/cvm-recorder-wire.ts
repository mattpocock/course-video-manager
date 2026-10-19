import type { DB } from "@/db/schema";
import type { Scene } from "@/packages/scene-layout";
import type { ClipRecordingSession } from "@/packages/clip-source";
import type { SilenceLength } from "@/silence-detection-constants";
import type {
  FramesLost,
  LostFrameSpan,
  ScreenStatus,
} from "recorder-service/protocol";

/** A Clip the app server saved from speech, with its Recording Session, so the editor plays it as the composite. */
export type SavedRecorderClip = DB.Clip & {
  recordingSession: ClipRecordingSession;
};

/**
 * Where a Take's Clip falls in its Recording Session, in picture time
 * (seconds): the bounds its Clip is cut to (`speechToClipBounds`).
 */
export type ClipSpan = { startTime: number; endTime: number };

/** What `POST /api/videos/:id/recorder/place-take` answers: the Clips saved where the editor said. */
export type PlacedTake = {
  clips: SavedRecorderClip[];
  /** The `transcribe-clips` Job the app server enqueued for them; null with none. */
  transcriptionJobId: string | null;
};

/**
 * What the app server's recorder client tells an editor open on a New
 * recorder Video, over `GET /api/videos/:videoId/recorder/events` (one SSE
 * event per message, its `type` as the event name). Every message is a fact:
 * the recorder service's events about this Video's Recording Sessions, after
 * the app server has saved what they mean, and the recorder's status.
 */
export type CvmRecorderMessage =
  | {
      /** Sent first, and whenever the recorder service comes or goes. */
      type: "recorder-status";
      /** False while nothing answers on the recorder service's port. */
      reachable: boolean;
      /**
       * Not reachable yet because the app server is starting the recorder
       * service for this editor (ADR 0053): a cold start, not a fault.
       */
      starting: boolean;
      /** Why the recorder cannot record (a wrong ffmpeg), when it cannot. */
      problem: string | null;
      /** The Recording Session in progress for this Video, if any. */
      recordingSessionId: string | null;
      /** Where the browser watches the raw camera and screen (H.264 streams, `latest-frame.ts`). */
      previews: { camera: string; screen: string };
      /** Where the browser fetches the camera's still (a 1280x720 JPEG): the thumbnail camera. */
      still: string;
    }
  /**
   * The Cam Link, while the recorder is open for this Video and not
   * recording. Record waits for `camera-went-live`.
   */
  | { type: "camera-opening"; attempt: number }
  | { type: "camera-went-live" }
  /** Three tries brought no frames: replug, then Retry. */
  | { type: "cam-link-not-starting"; message: string }
  /** Another program (OBS) holds the Cam Link: close it, then Retry. */
  | { type: "cam-link-busy"; message: string }
  /** The recorder is not open for this Video (closed, or open for another). */
  | { type: "camera-closed" }
  /**
   * The scene the picture is drawn in, while the recorder is open for this
   * Video: sent when the editor starts listening and on every switch.
   */
  | { type: "scene-changed"; scene: Scene }
  /**
   * A Short's screen (the Spacedesk display), while the recorder is open for
   * this Video: sent when the editor starts listening and whenever it
   * changes. Never sent for a Landscape Video.
   */
  | { type: "screen-changed"; screen: ScreenStatus }
  | {
      type: "recording-started";
      recordingSessionId: string;
      silenceLength: SilenceLength;
      /** The Recording Session's mic file: each of its Clips' Footage path. */
      micFile: string;
    }
  /** The take's first silence: ready for speech (speech-detector.ts). */
  | { type: "warmed-up"; recordingSessionId: string }
  | { type: "speech-started"; recordingSessionId: string }
  /**
   * The speech going now is long enough to be a Clip: a Take, decided by
   * the recorder service alone (speech-detector.ts), by the rule its Clip is
   * cut with. The editor shows its Optimistic Clip on this and nothing else.
   */
  | {
      type: "take-started";
      recordingSessionId: string;
      /** Unique to the Take: its Optimistic Clip's sound detection id. */
      takeId: string;
      /** Its speech's start in picture time: where its Clip will begin. */
      startTime: number;
    }
  /**
   * A speech ended. A Take's is sent before its Clip is saved: an editor
   * following the Recording Session answers with where to save it
   * (`place-take`). Speech that was no Take makes no Clip, and is not asked
   * about.
   */
  | {
      type: "speech-ended";
      recordingSessionId: string;
      /** A Take's: where its Clip falls. Absent for speech that was no Take. */
      clip?: ClipSpan;
    }
  | {
      /**
       * Speech the app server saved as Clips without an editor saying where
       * (none answered its `speech-ended`): after the Video's last item.
       */
      type: "clips-saved";
      recordingSessionId: string;
      clips: SavedRecorderClip[];
      /** The `transcribe-clips` Job the app server enqueued for them. */
      transcriptionJobId: string;
    }
  | {
      /**
       * The Cam Link went mid-recording: the recorder stopped the whole
       * Recording Session, keeping its files and the Clips so far.
       * `recording-stopped` follows.
       */
      type: "camera-lost";
      recordingSessionId: string;
      /** What ffmpeg said, if anything. */
      errors: string[];
    }
  /**
   * Frames were lost mid-recording (#2214): the Recording Session's running
   * totals, and every span lost so far (#2227). `recording-stopped` carries
   * the final ones.
   */
  | {
      type: "frames-lost";
      recordingSessionId: string;
      framesLost: FramesLost;
      lostFrameSpans: LostFrameSpan[];
    }
  | {
      type: "recording-stopped";
      recordingSessionId: string;
      /** Why the recorder stopped, when it was not asked to. */
      errors: string[];
      /**
       * True when the recorder service died mid-recording and found the
       * Recording Session on its next start, repaired.
       */
      crashed: boolean;
      /** Camera and screen frames lost; null when it crashed (not counted). */
      framesLost: FramesLost | null;
      /**
       * Every span lost; null when it crashed, or the recorder service is
       * older than protocol 17.
       */
      lostFrameSpans: LostFrameSpan[] | null;
    }
  | {
      /** The recorder service refused a command, or saving its events failed. */
      type: "recorder-failed";
      message: string;
    };

export const CVM_RECORDER_MESSAGE_TYPES = [
  "recorder-status",
  "camera-opening",
  "camera-went-live",
  "cam-link-not-starting",
  "cam-link-busy",
  "camera-closed",
  "scene-changed",
  "screen-changed",
  "recording-started",
  "warmed-up",
  "speech-started",
  "take-started",
  "speech-ended",
  "clips-saved",
  "camera-lost",
  "frames-lost",
  "recording-stopped",
  "recorder-failed",
] as const satisfies readonly CvmRecorderMessage["type"][];
