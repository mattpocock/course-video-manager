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
 * push is being retried; `ended`, saying why (End Stream, the Recording
 * Session ending on its own, the process quitting), until the next Go Live.
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

/** The Live Stream status of a recorder that has never gone live. */
export const STREAM_IDLE: StreamStatus = { kind: "idle" };

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
