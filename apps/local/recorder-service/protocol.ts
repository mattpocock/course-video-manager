import type { VideoFormat } from "@/features/videos/video-format";
import type { Scene } from "../app/packages/scene-layout";
import type { SilenceLength } from "../app/silence-detection-constants";
import type { LastPassedCalibration } from "../app/av-calibration-constants";
import type { ClapMark } from "../app/packages/clap-detection/live";
import type {
  StreamCommand,
  StreamHealthMessage,
  StreamStatus,
} from "./stream-protocol";
import type {
  ChatHighlightCommand,
  ChatHighlightEvent,
} from "./chat-highlight-protocol";

/**
 * THE RECORDER SERVICE'S WIRE: what a client (the app server's recorder
 * client, the Stream Deck forwarder) sends over the one WebSocket, and what
 * the service sends back. Why the service exists at all is ADR 0034.
 *
 * Two kinds of message come back:
 *
 * - **Recording Session events** carry a `seq`, counted from 1 per Recording
 *   Session, and are the same objects the service appends to that Recording
 *   Session's `events.jsonl`. A client that missed some (it restarted, its
 *   socket dropped) asks for `replay` after the last `seq` it saw and gets
 *   them again, read back from the log, so ingest can be idempotent per
 *   (Recording Session, seq).
 * - **Status messages** have no `seq` and are not logged: the greeting, the
 *   recorder's state, a refused command and the end of a replay.
 *
 * The same port serves the previews over HTTP, straight to the browser, as
 * low-latency H.264 streams the browser decodes itself: `GET
 * /preview/camera` and `GET /preview/screen` (`preview-feeds.ts`), and the
 * camera's still for the thumbnail camera: `GET /still` (`STILL_PATH`).
 *
 * TIME BASE. Every process stamps its frames with the one Windows wall clock,
 * less the Recording Session's T0, so a file time is seconds since T0. The
 * picture (screen and camera) is where Clips are cut: a scene change is
 * logged at the picture time it was asked for, `(now - T0) / 1000`. Speech
 * is heard in the mic file, which runs ahead of the picture by the Recording
 * Session's mic offset, so a speech time becomes picture time only once the
 * app server adds that offset; scenes and Clip bounds are then compared in
 * the same clock.
 */

/** The WebSocket and the previews' HTTP port. */
export const RECORDER_SERVICE_PORT = 5177;

/**
 * The app server's idle stop, sent to its child service over the IPC
 * channel (ADR 0053). The service refuses it while it records or a take is
 * still closing its files (`stopCleanlyOn`, #2383).
 */
export const IDLE_STOP = { type: "idle-stop" } as const;

/**
 * Bumped whenever the wire changes in a way an older service cannot follow
 * (2: a Short's `format` and `screen`; 3: the level meter; 4: the AV
 * Calibration run; 5: Record's silence threshold; 6: the calibration's true
 * peak; 7: Record carries its AV Calibration, and is gated on it; 8: the
 * recording-started event's `avCalibrationId`, renamed from Audio
 * Calibration; 9: the calibration run records the camera too, starts once
 * live, and cuts its clap window out of the true peak; 10: the
 * recording-started event's `devices`, for the pair's Mic Offset; 11: the
 * mic timed by sample count, which an older service's recordings are not, so
 * the app refuses to record through one; 12: Record's calibration names its
 * camera, and Record is gated on the camera + mic pair; 13: the previews are
 * pulled a frame at a time, not streamed as multipart; 14: the previews are
 * H.264 streams, not JPEGs; 15: `take-started`, without which the editor
 * shows no Take; 16: `frames-lost` mid-take, the screen's lost frames
 * counted, and the capture and writer at High priority; 17: `frames-lost`
 * and `recording-stopped` carry where in the take each loss fell,
 * `lostFrameSpans`; 18: the Live Stream, `start-stream`, `end-stream` and
 * the state's `stream`; 19: Chat Highlights,
 * `chat-highlight-protocol.ts`). The app server reloads on a change and the service does not
 * (ADR 0035), so after a pull mid-session the app may meet a service started
 * from older code; `hello` says which wire it speaks (none before 2).
 */
export const RECORDER_PROTOCOL_VERSION = 19;

export const PREVIEW_FEEDS = ["camera", "screen"] as const;
export type PreviewFeed = (typeof PREVIEW_FEEDS)[number];

/**
 * No frame for this long and a preview counts as stalled: the service starts
 * a preview-only process again (`preview-watchdog.ts`), and the browser
 * stops showing the frozen frame and says so.
 */
export const PREVIEW_STALL_MS = 3_000;

/** The path the service serves a preview feed on. */
export const previewPath = (feed: PreviewFeed) => `/preview/${feed}`;

/**
 * Where the service serves the camera's still: the latest 1280x720 JPEG of
 * the Cam Link, while the recorder is open and not recording (the thumbnail
 * camera, which used the OBS Virtual Camera). Otherwise it answers with an
 * error status and one of the messages below as plain text.
 */
export const STILL_PATH = "/still";

export const STILL_RECORDER_CLOSED =
  "The recorder is not open: it opens while the editor or the thumbnail camera is open on a CVM recorder Video.";
export const STILL_WHILE_RECORDING =
  "The recorder is recording: stop it to take a still.";
export const STILL_NO_PICTURE =
  "The camera has no picture yet: wait for it to go live.";

/**
 * The Cam Link while the recorder is open and not recording. It opens with
 * the recorder, and is live once its first real frame arrives; it is tried
 * up to three times before the service asks for a replug.
 */
export type CameraStatus =
  | { kind: "opening"; attempt: number }
  | { kind: "live" }
  /** Three tries brought no frames: "unplug and replug it", then Retry. */
  | { kind: "not-starting"; message: string }
  /** Another program (OBS) holds it. The service never closes OBS itself. */
  | { kind: "busy"; message: string };

/**
 * A Stream Deck button, as the forwarder passes it on. It acts on whichever
 * Video the recorder is open for; with none, or when the recorder cannot do
 * it, the service does nothing and says why (`stream-deck-ignored`).
 */
export type StreamDeckPress =
  | { action: "record" }
  | { action: "stop" }
  /** One key for both: stops while recording, records otherwise. */
  | { action: "toggle-record" }
  | { action: "switch-scene"; scene: Scene };

/**
 * A Short's screen: the Spacedesk virtual display. `waking` while the service
 * looks for it and, when it is not listed, wakes Spacedesk; `ready` once it is
 * listed and square or 16:9 (1080x1080, ADR 0043; a Short shows its left
 * square, all of a square display);
 * `unavailable` otherwise, saying why. Unavailable,
 * a Short records camera and mic only, in scenes that do not draw the screen.
 */
export type ScreenStatus =
  | { kind: "waking" }
  | { kind: "ready" }
  | { kind: "unavailable"; message: string };

export type RecorderCommand =
  /**
   * Open the recorder for a Video of this format (absent: Landscape): opens
   * the camera and the previews; a Short also looks for (and wakes) the
   * Spacedesk display. Open already, for any Video, it keeps the camera and
   * changes the Video; a different format starts the screen side again.
   */
  | { type: "open"; videoId: string; format?: VideoFormat }
  /** Try the camera again after `not-starting` or `busy`. */
  | { type: "retry-camera" }
  /** A Short's screen: wake Spacedesk and check its display again. */
  | { type: "retry-screen" }
  /**
   * Draw the picture in this scene from now on. Open, it is the scene the
   * preview shows and the next Recording Session starts in; recording, it
   * is also logged as a `scene-changed`.
   */
  | { type: "switch-scene"; scene: Scene }
  /**
   * Start a Recording Session in a new folder under `folder` (a WSL path),
   * its silencedetect cutting with the threshold of `calibration`, the
   * latest AV Calibration passed under today's rules (null: none). THE
   * GATE (ADR 0038): refused unless that calibration is less than 7 days old
   * by the service's clock and was taken on the camera + mic pair the
   * service records now (`calibrationValidity`). Refused without the field at all
   * (`CALIBRATION_REQUIRED`). Checked only here, at the start: a Recording
   * Session already running is never stopped by it.
   */
  | {
      type: "record";
      silenceLength: SilenceLength;
      folder: string;
      calibration: LastPassedCalibration | null;
    }
  | { type: "stop" }
  | { type: "close" }
  /**
   * What a Stream Deck Record records with on this Video: the editor's
   * Silence Length, the recordings folder, and the AV Calibration. Kept
   * until the recorder closes or opens for another Video; the press is
   * gated as `record` is, when it is pressed. Refused without the
   * calibration field, as `record` is.
   */
  | {
      type: "prepare-record";
      videoId: string;
      silenceLength: SilenceLength;
      folder: string;
      calibration: LastPassedCalibration | null;
    }
  | { type: "stream-deck"; press: StreamDeckPress }
  /** Send this Recording Session's logged events with `seq > afterSeq`. */
  | { type: "replay"; recordingSessionId: string; afterSeq: number }
  /**
   * Start the level meter (`level-meter.ts`): the mic's loudness, streamed as
   * `meter-reading`s until `stop-meter` or until the client that started it
   * goes. Refused while recording, as Record is refused while it runs.
   * Started already, it carries on.
   */
  | { type: "start-meter" }
  /** Stops the meter; a calibration run in progress is discarded with it. */
  | { type: "stop-meter" }
  /**
   * Start an AV Calibration's run (`calibration-run.ts`): the meter's
   * process, which also opens the camera and writes the mic and the camera
   * to files in a new folder under `folder` (a WSL path), on one shared
   * clock, its readings timed in the files' seconds. Answered once the run
   * is live (`calibration-started`), or refused with why it could not open.
   * Refused while recording, as Record is refused while it runs.
   */
  | { type: "start-calibration"; folder: string }
  /**
   * End the run and measure its mic file: the noise floor over `silence`,
   * the integrated speech loudness over the `speech` windows, and the true
   * peak over the whole take but `claps`, in file seconds. The meter carries
   * on after it.
   */
  | {
      type: "finish-calibration";
      silence: CalibrationWindow;
      speech: readonly CalibrationWindow[];
      claps: CalibrationWindow;
    }
  /** End the run and delete its file: a cancelled calibration keeps nothing. */
  | { type: "cancel-calibration" }
  /** Go Live and End Stream (`stream-protocol.ts`). */
  | StreamCommand
  | ChatHighlightCommand;

/** A stretch of a calibration's mic file, in its seconds. */
export type CalibrationWindow = { startSeconds: number; endSeconds: number };

/**
 * Why a `record` or `prepare-record` with no `calibration` field is refused:
 * the app server that sent it is older than the AV Calibration gate.
 */
export const CALIBRATION_REQUIRED =
  "Record needs its AV Calibration, which this app server does not send: reload the app.";

/** Why the meter will not start while recording. */
export const METER_WHILE_RECORDING =
  "The recorder is recording: stop recording before you check your mic level.";
/** Why a calibration run will not start while recording. */
export const CALIBRATION_WHILE_RECORDING =
  "The recorder is recording: stop recording before you run an AV Calibration.";
/** Why Record is refused while the meter (or a calibration run) runs. */
export const RECORD_WHILE_METERING =
  "The AV Calibration page is measuring your mic: close it before you record.";

/**
 * One ebur128 reading of the mic, in LUFS. `seconds` is since the meter
 * started. Momentary is the last 400 ms, short-term the last 3 s.
 */
export type MeterReading = {
  seconds: number;
  momentaryLufs: number;
  shortTermLufs: number;
};

export type RecordingSessionFiles = {
  camera: string;
  screen: string;
  mic: string;
};

/**
 * Frames lost in a Recording Session, per picture file: the frames
 * DirectShow dropped from a full real-time buffer, and any gap in the frames
 * reaching a writer (each filled with repeats). See recording-session.ts,
 * FRAMES LOST. `screen` is null with no screen recorder, and in logs written
 * before the screen's were counted (#2214).
 */
export type FramesLost = { camera: number; screen: number | null };

/**
 * Where in a take frames were lost (#2227): `frames` of `picture` lost from
 * `from` to `to`, in picture file time. Losses close together are merged
 * into one span; a DirectShow buffer drop has no frame time, so it is
 * stamped with the clock's picture time when it was heard (`from === to`).
 * The editor alerts only for spans inside a Clip.
 */
export type LostFrameSpan = {
  picture: "camera" | "screen";
  from: number;
  to: number;
  frames: number;
};

/**
 * What a file needed after a crash: `readable` as it was, `remuxed` to give
 * it a duration (the raw file is kept as `<name>.raw.mkv`), `missing`, or
 * `failed` (left as it was).
 */
export type FileRepair = "readable" | "remuxed" | "missing" | "failed";

type Logged<T> = T & { seq: number; recordingSessionId: string };

export type RecordingSessionEvent = Logged<
  | {
      type: "recording-started";
      videoId: string;
      /** Windows wall-clock ms that is file time 0 in all three files. */
      t0Ms: number;
      silenceLength: SilenceLength;
      /**
       * `files.screen` names where the screen would be even when it is not
       * captured (a Short whose Spacedesk display was unavailable).
       */
      files: RecordingSessionFiles;
      /** The Video's format. Absent in logs written before Shorts: Landscape. */
      format?: VideoFormat;
      /** Whether a screen process recorded `files.screen`. Absent: true. */
      screenCaptured?: boolean;
      /**
       * The silence threshold its silencedetect cuts with. Absent in logs
       * written before AV Calibration: the fixed default.
       */
      thresholdDb?: number;
      /** The AV Calibration that set it; null or absent: none. */
      avCalibrationId?: string | null;
      /**
       * The camera and mic it records (DirectShow names): the pair whose Mic
       * Offset it starts with. Absent in logs written before protocol 10:
       * DEFAULT_MIC_OFFSET_MS.
       */
      devices?: { camera: string; mic: string };
    }
  /**
   * The scene from here on, in picture file time. Every Recording Session
   * logs the scene it starts in at 0, right after `recording-started`.
   */
  | { type: "scene-changed"; scene: Scene; fileTime: number }
  /** A Chat Highlight went on or off the Live Stream picture. */
  | ChatHighlightEvent
  /**
   * Frames were lost mid-take (#2214): the running totals so far, and every
   * span lost so far (#2227), sent at once so the editor can alert while the
   * take is still going. The same end up in `recording-stopped`.
   */
  | ({
      type: "frames-lost";
      fileTime: number;
      /** Absent in logs written before protocol 17. */
      lostFrameSpans?: LostFrameSpan[];
    } & FramesLost)
  /** The screen recorder's 1 ms timer, no-throttling and High priority. */
  | { type: "screen-recorder-tuned"; ok: boolean; detail: string }
  /**
   * The mic's first silence as long as the Silence Length, before any
   * speech: the take is ready for speech (speech-detector.ts).
   */
  | { type: "warmed-up"; fileTime: number }
  /** Speech in the mic file, in seconds of file time. */
  | { type: "speech-started"; fileTime: number }
  /**
   * The speech going now is long enough to be a Clip: a Take
   * (speech-detector.ts). Its `speech-ended` makes a Clip; speech that ends
   * with no `take-started` makes none. `fileTime`: when it was decided.
   */
  | { type: "take-started"; fileTime: number }
  | { type: "speech-ended"; fileTime: number }
  /**
   * The camera process quit on its own, or the Cam Link stopped sending
   * frames: the Recording Session stops (`recording-stopped` follows, reason
   * `camera-lost`), keeping its files.
   */
  | { type: "camera-lost"; fileTime: number; errors: string[] }
  | {
      type: "recording-stopped";
      /**
       * `ffmpeg-exited`: the screen process quit on its own and the camera's
       * was stopped. `camera-lost`: see `camera-lost`. `event-log-failed`:
       * `events.jsonl` could not be written, so both were stopped rather than
       * record what a replay could never send.
       */
      reason:
        "requested" | "ffmpeg-exited" | "camera-lost" | "event-log-failed";
      fileTime: number;
      files: RecordingSessionFiles;
      /** `screen` is null when no screen was captured (a camera-only Short). */
      exitCodes: { screen: number | null; camera: number | null };
      framesLost: FramesLost;
      /** Every span of the take lost, told or not; absent before protocol 17. */
      lostFrameSpans?: LostFrameSpan[];
      /** Why the event log failed, and the last error lines of a process that quit on its own. */
      errors: string[];
    }
  /**
   * Found at start-up with no stop in its log: the recorder service died
   * while it recorded. Logged then, after a `speech-ended` at the end of the
   * repaired mic file for a take still going at the crash.
   */
  | {
      type: "recording-crashed";
      files: RecordingSessionFiles;
      repairs: Record<keyof RecordingSessionFiles, FileRepair>;
    }
>;

/**
 * `scene`: what the preview draws, and what Record starts in. `format`: the
 * Video's. `screen`: a Short's Spacedesk display; null for Landscape, whose
 * DELL is checked at Record.
 */
type OpenFor = {
  videoId: string;
  format: VideoFormat;
  scene: Scene;
  screen: ScreenStatus | null;
  /** The Live Stream: live only while the streamed Recording Session records. */
  stream: StreamStatus;
};

export type RecorderState =
  | { kind: "closed" }
  | ({ kind: "open"; camera: CameraStatus } & OpenFor)
  | ({
      kind: "recording";
      recordingSessionId: string;
      lastSeq: number;
    } & OpenFor);

/** How many of its latest Recording Sessions the service names in `hello`. */
export const RECENT_SESSIONS = 20;

export type FfmpegCheck =
  { ok: true; version: string } | { ok: false; message: string };

export type RecorderStatusMessage =
  | {
      type: "hello";
      /** `RECORDER_PROTOCOL_VERSION` of the service's code; absent before 2. */
      protocol?: number;
      ffmpeg: FfmpegCheck;
      /** Start-up warnings that do not stop recording (an NVIDIA driver change). */
      warnings: string[];
      state: RecorderState;
      /**
       * Recording Sessions this run of the service found cut off and logged
       * `recording-crashed` for. A client replays each to catch up.
       */
      recovered: string[];
      /**
       * The last `RECENT_SESSIONS` Recording Sessions the service started,
       * oldest first. A take filmed from the Stream Deck while no app server
       * listened is among them; a client replays any it has not seen finish.
       */
      recent: string[];
    }
  | { type: "state"; state: RecorderState }
  | { type: "refused"; command: RecorderCommand["type"]; message: string }
  /** A Stream Deck press the recorder did nothing about, and why. Broadcast. */
  | { type: "stream-deck-ignored"; press: StreamDeckPress; message: string }
  | { type: "replay-done"; recordingSessionId: string; lastSeq: number }
  | StreamHealthMessage
  /** The level meter: started (on this mic), a reading, stopped. Broadcast. */
  | { type: "meter-started"; mic: string }
  | ({ type: "meter-reading" } & MeterReading)
  /** `message`: why, when it quit without being asked; null when asked. */
  | { type: "meter-stopped"; message: string | null }
  /**
   * An AV Calibration's run is live: from here on, `meter-reading`s are
   * timed in seconds of `micFile` and `cameraFile` (WSL paths, one clock),
   * until it ends. The files' clock started before the camera opened, so
   * the script starts at `scriptStartSeconds`. Broadcast.
   */
  | {
      type: "calibration-started";
      calibrationId: string;
      mic: string;
      micFile: string;
      camera: string;
      cameraFile: string;
      scriptStartSeconds: number;
    }
  /**
   * A run's live clap marks (`live-claps.ts`): every clap the mic has heard
   * in the clap window so far, in seconds of its files, and whether the
   * camera saw it. Sent whenever they change. Broadcast.
   */
  | { type: "calibration-claps"; calibrationId: string; claps: ClapMark[] }
  /** The run ended and its mic file was measured. Broadcast. */
  | ({
      type: "calibration-measured";
      calibrationId: string;
      mic: string;
      micFile: string;
      camera: string;
      cameraFile: string;
    } & CalibrationMeasurement)
  /**
   * The run ended without a measurement and its folder was deleted:
   * cancelled, its client went, or `message` says what failed. Broadcast.
   */
  | {
      type: "calibration-ended";
      calibrationId: string;
      message: string | null;
    };

/**
 * What a calibration run measured: the noise floor (the RMS level of the
 * silence, dBFS), the integrated loudness of the speech (LUFS) and the true
 * peak of the take less its clap window (dBTP).
 */
export type CalibrationMeasurement = {
  noiseFloorDb: number;
  speechLufs: number;
  truePeakDb: number;
};

export type RecorderMessage = RecordingSessionEvent | RecorderStatusMessage;
