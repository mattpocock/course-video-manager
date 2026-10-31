import path from "node:path";
import type { Scene } from "../app/packages/scene-layout";
import type { Capture } from "./camera";
import type { Launcher } from "./launcher";
import type {
  RecorderCommand,
  RecorderMessage,
  RecorderState,
} from "./protocol";
import type { ChatHighlightCommand } from "./chat-highlight-protocol";
import { CHAT_HIGHLIGHT_REFUSALS } from "./chat-highlight-protocol";
import { startChatHighlights, type ChatHighlights } from "./chat-highlights";
import {
  BUSY_STREAMING,
  GO_LIVE_REFUSALS,
  type LiveStreamStoppedMessage,
  type StreamHealth,
  type StreamStatus,
} from "./stream-protocol";
import type { RecordingSession } from "./recording-session";
import type { StopReason, TakeSettings } from "./take-settings";
import { Refusal } from "./refusal";
import { YOUTUBE_INGEST } from "./stream-args";
import { pickStreamFeedPorts, type StreamFeedPorts } from "./stream-feeds";
import {
  createStreamSide,
  redactStreamKey,
  STREAM_LISTEN_BOUND_MS,
  STREAM_STALL_MS,
} from "./stream-side";
import { CARD_ANSWER_MS } from "./card-server";
import { openStreamHealthLog } from "./stream-health";

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
  /** Why the screen can't be recorded now (the DELL), if it can't. */
  screenRefusal: () => Promise<string | null>;
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
  streamIngest: string;
  /** How long Record waits for the stream to listen (`STREAM_LISTEN_BOUND_MS`). */
  streamListenBoundMs: number;
  /** No new frame this long and the stream process has stalled (`STREAM_STALL_MS`). */
  streamStallMs: number;
  /** How long a card's still may take before its click is refused (`CARD_ANSWER_MS`). */
  cardAnswerMs: number;
  /** Windows wall-clock ms, the Recording Session's T0's clock. */
  now: () => number;
};

/** The Live Stream's settings on the rig: every caller but a test passes these. */
export const LIVE_STREAM_SETTINGS = {
  streamIngest: YOUTUBE_INGEST,
  streamListenBoundMs: STREAM_LISTEN_BOUND_MS,
  streamStallMs: STREAM_STALL_MS,
  cardAnswerMs: CARD_ANSWER_MS,
} satisfies Partial<LiveStreamOptions>;

export const createGoLive = (
  o: LiveStreamOptions & {
    onStatus: (status: StreamStatus) => void;
    onHealth: (health: StreamHealth) => void;
    /** After End Stream, once the push has stopped. */
    onPushStopped: (message: LiveStreamStoppedMessage) => void;
  }
) => {
  const side = createStreamSide({
    launch: o.launch,
    listenBoundMs: o.streamListenBoundMs,
    stallMs: o.streamStallMs,
    fileTime: () => (streamed ? (o.now() - streamed.t0Ms) / 1000 : null),
    onStatus: o.onStatus,
    onHealth: (health) => {
      o.onHealth(health);
      if (streamed)
        healthLog?.write({
          atMs: o.now(),
          fileTime: (o.now() - streamed.t0Ms) / 1000,
          ...health,
        });
    },
    // Each launch, a relaunch too, reads the card from its picture's start.
    onLaunch: (startSeconds) => highlights?.launching(startSeconds),
  });
  /** The Recording Session Go Live started: its end ends the Live Stream. */
  let streamed: RecordingSession | undefined;
  /** The Broadcast the Live Stream goes out on. */
  let broadcastId = "";
  /** What Go Live arms the streamed writer with, until Record has begun. */
  let goingLive: TakeSettings | undefined;
  /** Its health, second by second, in the streamed Recording Session's folder. */
  let healthLog: ReturnType<typeof openStreamHealthLog> | undefined;
  /** The Live Stream's Chat Highlights: its card server and card feed. */
  let highlights: ChatHighlights | undefined;
  const endHighlights = () => {
    void highlights?.close();
    highlights = undefined;
  };

  /** Every reason the recorder refuses Go Live for now. */
  const refusals = async (r: GoLiveRecorder): Promise<string[]> => {
    const state = r.state();
    if (state.kind === "closed") return [GO_LIVE_REFUSALS.closed];
    const screen = state.format === "short" ? null : await r.screenRefusal();
    return [
      state.kind === "recording" && GO_LIVE_REFUSALS.recording,
      state.format === "short" && GO_LIVE_REFUSALS.short,
      !r.screenPreviewOnNvenc() && GO_LIVE_REFUSALS.cpuPreview,
      state.kind === "open" &&
        state.camera.kind !== "live" &&
        GO_LIVE_REFUSALS.cameraNotLive,
      r.metering() && GO_LIVE_REFUSALS.metering,
      screen,
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
      healthLog?.close();
      healthLog = undefined;
      side.end(why);
      endHighlights();
    },

    /**
     * GO LIVE, in the command queue: the camera writer armed again as a
     * streamed writer, the Live Stream started listening for its feeds
     * (waited for only `STREAM_LISTEN_BOUND_MS`), then Record. Refused with
     * every reason that applies. Nothing it says carries the Stream Key.
     */
    goLive: async (command: StartStream, r: GoLiveRecorder) => {
      const reasons = await refusals(r);
      if (reasons.length > 0) throw new Refusal(reasons.join(" "));
      const capture = r.capture();
      if (!capture) throw new Refusal(GO_LIVE_REFUSALS.cameraNotLive);
      const redact = redactStreamKey(command.streamKey);
      // The gate first, as Record's: a stale AV Calibration starts nothing.
      const { thresholdDb } = await r.gate(command.record.calibration);
      const ports = pickStreamFeedPorts();
      try {
        // First, so the card server warms while the take arms (`chat-highlights.ts`).
        highlights = await startChatHighlights({
          launch: o.launch,
          now: o.now,
          answerMs: o.cardAnswerMs,
        });
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
          ingest: o.streamIngest,
          streamKey: command.streamKey,
          card: highlights.card,
        });
        await r.record({ type: "record", ...command.record }, ports);
        streamed = r.session();
        broadcastId = command.broadcastId;
        if (streamed) {
          highlights.begin(streamed);
          healthLog = openStreamHealthLog(path.dirname(streamed.eventLog));
        }
        console.log(
          `recorder: Go Live: streamed Recording Session ${streamed?.id} for Broadcast ${command.broadcastId}`
        );
      } catch (e) {
        const message = redact(e instanceof Error ? e.message : String(e));
        side.end(`Go Live failed: ${message}`);
        endHighlights();
        if (!(e instanceof Refusal))
          console.error(`recorder: Go Live failed: ${message}`);
        throw new Refusal(message);
      } finally {
        goingLive = undefined;
        r.rearm();
      }
    },

    /**
     * END STREAM: the push and the streamed Recording Session stop together.
     * `onPushStopped` hears once the stream's process has gone, which
     * nothing in the command queue waits for.
     */
    endStream: (r: GoLiveRecorder) => {
      if (!streamed || r.session() !== streamed)
        throw new Refusal("There is no Live Stream to end.");
      const broadcast = broadcastId;
      r.stop(ENDED_BY_END_STREAM);
      void side.close(ENDED_BY_END_STREAM).then(() =>
        o.onPushStopped({
          type: "live-stream-stopped",
          broadcastId: broadcast,
        })
      );
    },

    /**
     * A CHAT HIGHLIGHT command, outside the command queue: a card takes a
     * moment to draw, and nothing else waits behind it. Its answer is the
     * edge logged in the streamed Recording Session; a refusal is `reply`d.
     */
    highlight: (
      command: ChatHighlightCommand,
      reply: (message: RecorderMessage) => void
    ) => {
      const refuse = (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (!(e instanceof Refusal))
          console.error(`recorder: ${command.type} failed: ${message}`);
        reply({ type: "refused", command: command.type, message });
      };
      if (!highlights)
        return refuse(new Refusal(CHAT_HIGHLIGHT_REFUSALS.notLive));
      void highlights.command(command).catch(refuse);
    },

    close: () => {
      endHighlights();
      return side.close("The recorder service stopped.");
    },
  };
};
