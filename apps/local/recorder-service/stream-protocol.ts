import type { MicEq } from "@cvm/core/features/videos/recorder";
import type { LastPassedCalibration } from "../app/av-calibration-constants";
import type { SilenceLength } from "../app/silence-detection-constants";
import { RECORD_WHILE_METERING } from "./protocol";

/**
 * THE LIVE STREAM ON THE RECORDER'S WIRE (ADR 0054, protocol 18): its two
 * commands, its status in the recorder's state, and why Go Live is refused.
 */

/**
 * The Live Stream, as the open recorder holds it: `idle` before any Go
 * Live; `starting` from Go Live until the stream process is up;
 * `connecting` until it pushes a picture; `live`; `reconnecting` while its
 * push is being retried or its process relaunched (it reconnects for ever,
 * until End Stream); `ended`, saying why (End Stream, the Recording
 * Session ending on its own, Go Live failing), until the next Go Live. A
 * stream process that quits never ends it.
 * A Live Stream always runs with exactly one Recording Session: the
 * streamed one, which Go Live starts.
 */
export type StreamStatus =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "reconnecting" }
  | { kind: "ended"; reason: string };

/**
 * How the Live Stream is doing (stories 46–47), from its process's
 * -progress: sent about once a second while one runs, and at each
 * reconnect, as the status message `stream-health`. Never logged, and never
 * a Recording Session event.
 */
export type StreamHealth = {
  /** ffmpeg's frames per second over this stream process's run. */
  fps: number | null;
  /** ffmpeg's speed: 1 is real time. */
  speed: number | null;
  droppedFrames: number;
  duplicatedFrames: number;
  /** What it pushed over the last second, kbit/s: 0 while YouTube is unreachable. */
  bitrateKbps: number | null;
  /** Times it reconnected since Go Live: its push retried, or its process relaunched. */
  reconnects: number;
};

/** The Live Stream's health, broadcast; a status message, not logged. */
export type StreamHealthMessage = {
  type: "stream-health";
  health: StreamHealth;
};

/** The Live Stream status of a recorder that has never gone live. */
export const STREAM_IDLE: StreamStatus = { kind: "idle" };

/**
 * Whether the Live Stream is on: from Go Live until it ends. It is on only
 * while its streamed Recording Session records (or Go Live is starting it).
 */
export const isStreamOn = (status: StreamStatus | null | undefined) =>
  status !== null &&
  status !== undefined &&
  status.kind !== "idle" &&
  status.kind !== "ended";

/**
 * BUSY STREAMING (ADR 0055): while live, only End Stream ends the streamed
 * Recording Session. Stop, close, opening the recorder for another Video
 * and the idle stop are refused, and the Stream Deck's Record and Stop do
 * nothing; scene presses still act.
 */
export const BUSY_STREAMING =
  "The recorder is busy streaming: only End Stream on the Streaming tab ends the Live Stream and its Recording Session.";

/** What another Video's editor is told while the recorder is live. */
export const BUSY_STREAMING_ANOTHER_VIDEO =
  "The recorder is busy streaming another Video: End Stream on the Streaming tab first.";

/** Why a Stream Deck Record or Stop does nothing while live. */
export const STREAM_DECK_WHILE_LIVE =
  "Record and Stop do nothing while live: End Stream on the Streaming tab ends the Live Stream and its Recording Session.";

/** Why Go Live is refused, by the recorder: each that applies is said. */
export const GO_LIVE_REFUSALS = {
  closed:
    "The recorder is not open: open the Streaming tab on a Landscape Video first.",
  recording:
    "The recorder is already recording: stop it first, so the Live Stream starts its own Recording Session.",
  short:
    "The recorder is open for a Short: a Live Stream is always drawn Landscape.",
  cpuPreview:
    "The screen preview fell back to the CPU encoder: restart the recorder so it is back on NVENC before going live.",
  cameraNotLive: "The camera is not live yet.",
  metering: RECORD_WHILE_METERING,
} as const;

/**
 * GO LIVE (ADR 0054): a streamed Recording Session and the Live Stream it
 * feeds, in this order: the camera writer is armed again as a streamed
 * writer, the stream process starts listening for its feeds, then Record
 * as `record` (gated the same), waiting for the stream only
 * `STREAM_LISTEN_BOUND_MS`. Refused, with every reason that applies
 * (`GO_LIVE_REFUSALS`), unless open for a Landscape Video, not recording,
 * the camera live and the screen preview on NVENC. `streamKey` appears
 * only on the stream process's command line: never in a log, a refusal,
 * `events.jsonl` or the service's state folder. The Mic Offset and Mic EQ
 * are read once, here.
 */
export type StreamCommand =
  | {
      type: "start-stream";
      broadcastId: string;
      streamKey: string;
      micOffsetMs: number;
      micEq: MicEq;
      record: {
        silenceLength: SilenceLength;
        folder: string;
        calibration: LastPassedCalibration | null;
      };
    }
  /**
   * END STREAM: stops the push and the streamed Recording Session together,
   * the last Take let go exactly as Stop lets it go (ADR 0048).
   */
  | { type: "end-stream" };
