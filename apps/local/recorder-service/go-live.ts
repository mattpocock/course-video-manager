import type { Scene } from "../app/packages/scene-layout";
import type { Capture } from "./camera";
import type { Launcher } from "./launcher";
import type { RecorderCommand, RecorderState } from "./protocol";
import {
  BUSY_STREAMING,
  GO_LIVE_REFUSALS,
  type StreamHealth,
  type StreamStatus,
} from "./stream-protocol";
import type { RecordingSession } from "./recording-session";
import type { StopReason, TakeSettings } from "./take-settings";
import { Refusal } from "./refusal";
import { YOUTUBE_INGEST } from "./stream-args";
import { pickStreamFeedPorts, type StreamFeedPorts } from "./stream-feeds";
import { createStreamSide, redactStreamKey } from "./stream-side";

/**
 * GO LIVE AND END STREAM in the recorder service (ADR 0054): a streamed
 * Recording Session and the Live Stream it feeds (`stream-side.ts`), started
 * together and ended together. End Stream, or the streamed Recording Session
 * ending in any way, ends the Live Stream. The Live Stream never stops or
 * delays the recording: nothing here stops a take but End Stream.
 *
 * Busy streaming (ADR 0055): from Go Live until its streamed Recording
 * Session ends, only End Stream ends it. Stop, close and open (for another
 * Video, or anything) are refused, and the service counts as busy, so its
 * idle stop is refused too.
 */

/** What the service refuses while live: only End Stream ends a streamed Recording Session. */
const REFUSED_WHILE_LIVE: readonly RecorderCommand["type"][] = [
  "stop",
  "close",
  "open",
];

/** Why a streamed Recording Session's Live Stream ended with it. */
export const STREAM_ENDED: Record<StopReason, string> = {
  requested: "The Recording Session was stopped.",
  "camera-lost": "The Recording Session ended on its own: the camera was lost.",
  "ffmpeg-exited":
    "The Recording Session ended on its own: a recording process quit.",
  "event-log-failed":
    "The Recording Session ended on its own: its event log could not be written.",
};

/** Why the Live Stream ended at End Stream. */
export const ENDED_BY_END_STREAM = "End Stream.";

type StartStream = Extract<RecorderCommand, { type: "start-stream" }>;

/** What Go Live needs of the rest of the service. */
export type GoLiveRecorder = {
  state: () => RecorderState;
  /** The live camera capture, if the camera is live. */
  capture: () => Capture | undefined;
  screenPreviewOnNvenc: () => boolean;
  metering: () => boolean;
  /** Record's gate (`devices.forRecord`): the calibration it lets through. */
  gate: (
    calibration: StartStream["record"]["calibration"]
  ) => Promise<{ thresholdDb: number }>;
  /** Waits for the last take's writer to let the relay go. */
  relayFree: () => Promise<void>;
  /** Arms a writer with these settings now (`take-arming.ts`). */
  prepare: (settings: TakeSettings) => Promise<void>;
  /** Arms whatever the next take wants, once Go Live is over. */
  rearm: () => void;
  record: (
    command: Extract<RecorderCommand, { type: "record" }>,
    streamed: StreamFeedPorts
  ) => Promise<void>;
  /** The Recording Session recording now. */
  session: () => RecordingSession | undefined;
  /** Stop, with why the Live Stream ends. */
  stop: (streamReason: string) => void;
};

/** The recorder service's options for its Live Stream. */
export type LiveStreamOptions = {
  launch: Launcher;
  /** Where a Live Stream goes: YouTube (`YOUTUBE_INGEST`), or the scorecard's sink. */
  streamIngest?: string;
  /** `STREAM_LISTEN_BOUND_MS` (tests). */
  streamListenBoundMs?: number;
  /** `STREAM_STALL_MS` (tests). */
  streamStallMs?: number;
  /** Windows wall-clock ms, the Recording Session's T0's clock. */
  now: () => number;
};

export const createGoLive = (
  o: LiveStreamOptions & {
    onStatus: (status: StreamStatus) => void;
    onHealth: (health: StreamHealth) => void;
  }
) => {
  const side = createStreamSide({
    launch: o.launch,
    listenBoundMs: o.streamListenBoundMs,
    stallMs: o.streamStallMs,
    fileTime: () => (streamed ? (o.now() - streamed.t0Ms) / 1000 : null),
    onStatus: o.onStatus,
    onHealth: o.onHealth,
  });
  /** The Recording Session Go Live started: its end ends the Live Stream. */
  let streamed: RecordingSession | undefined;
  /** What Go Live arms the streamed writer with, until Record has begun. */
  let goingLive: TakeSettings | undefined;

  /** Every reason the recorder refuses Go Live for now. */
  const refusals = (r: GoLiveRecorder): string[] => {
    const state = r.state();
    if (state.kind === "closed") return [GO_LIVE_REFUSALS.closed];
    return [
      state.kind === "recording" && GO_LIVE_REFUSALS.recording,
      state.format === "short" && GO_LIVE_REFUSALS.short,
      !r.screenPreviewOnNvenc() && GO_LIVE_REFUSALS.cpuPreview,
      state.kind === "open" &&
        state.camera.kind !== "live" &&
        GO_LIVE_REFUSALS.cameraNotLive,
      r.metering() && GO_LIVE_REFUSALS.metering,
    ].filter((reason) => typeof reason === "string");
  };

  /** From Go Live until its streamed Recording Session ends. */
  const streaming = () => streamed !== undefined || goingLive !== undefined;

  return {
    status: () => side.status(),
    streaming,
    /** Refuses what would end, or take, the recorder while live. */
    refuseWhileLive: (command: RecorderCommand["type"]) => {
      if (streaming() && REFUSED_WHILE_LIVE.includes(command))
        throw new Refusal(BUSY_STREAMING);
    },
    /** The streamed writer Go Live is arming, if it is. */
    goingLive: () => goingLive,
    /** The service's scene changed: the Live Stream follows it. */
    sceneSwitched: (scene: Scene) => side.switchScene(scene),
    /** A Recording Session stopped: if it was streamed, the Live Stream ends. */
    sessionEnded: (session: RecordingSession, why: string) => {
      if (streamed !== session) return;
      streamed = undefined;
      side.end(why);
    },

    /**
     * GO LIVE, in the command queue: the camera writer armed again as a
     * streamed writer, the Live Stream started listening for its feeds
     * (waited for only `STREAM_LISTEN_BOUND_MS`), then Record. Refused with
     * every reason that applies. Nothing it says carries the Stream Key.
     */
    goLive: async (command: StartStream, r: GoLiveRecorder) => {
      const reasons = refusals(r);
      if (reasons.length > 0) throw new Refusal(reasons.join(" "));
      const capture = r.capture();
      if (!capture) throw new Refusal(GO_LIVE_REFUSALS.cameraNotLive);
      const redact = redactStreamKey(command.streamKey);
      // The gate first, as Record's: a stale AV Calibration starts nothing.
      const { thresholdDb } = await r.gate(command.record.calibration);
      const ports = pickStreamFeedPorts();
      try {
        await r.relayFree();
        goingLive = {
          folder: command.record.folder,
          silenceLength: command.record.silenceLength,
          thresholdDb,
          relayPort: capture.writerRelay,
          streamed: ports,
        };
        await r.prepare(goingLive);
        const state = r.state();
        await side.start({
          ports,
          scene: state.kind === "closed" ? "Code" : state.scene,
          micOffsetMs: command.micOffsetMs,
          micEq: command.micEq,
          ingest: o.streamIngest ?? YOUTUBE_INGEST,
          streamKey: command.streamKey,
        });
        await r.record({ type: "record", ...command.record }, ports);
        streamed = r.session();
        console.log(
          `recorder: Go Live: streamed Recording Session ${streamed?.id} for Broadcast ${command.broadcastId}`
        );
      } catch (e) {
        const message = redact(e instanceof Error ? e.message : String(e));
        side.end(`Go Live failed: ${message}`);
        if (!(e instanceof Refusal))
          console.error(`recorder: Go Live failed: ${message}`);
        throw new Refusal(message);
      } finally {
        goingLive = undefined;
        r.rearm();
      }
    },

    /** END STREAM: the push and the streamed Recording Session stop together. */
    endStream: (r: GoLiveRecorder) => {
      if (!streamed || r.session() !== streamed)
        throw new Refusal("There is no Live Stream to end.");
      r.stop(ENDED_BY_END_STREAM);
    },

    close: () => side.close("The recorder service stopped."),
  };
};
