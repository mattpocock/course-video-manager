import { Redacted } from "effect";
import type { MicEq } from "@cvm/core/features/videos/recorder";
import type { LastPassedCalibration } from "@/av-calibration-constants";
import type { VideoFormat } from "@/features/videos/video-format";
import type { SilenceLength } from "@/silence-detection-constants";
import type {
  RecorderCommand,
  RecorderMessage,
  RecorderState,
} from "recorder-service/protocol";
import {
  GO_LIVE_REFUSALS,
  isStreamOn,
  type StreamStatus,
} from "recorder-service/stream-protocol";
import { END_STREAM_WAIT_MS } from "@/features/streaming/broadcast";
import { NOT_RUNNING, RecorderRefusedError } from "./recorder-command";

/** End Stream's longest wait: its command may take that much longer. */
const LONGEST_END_STREAM_WAIT_MS = Math.max(
  ...Object.values(END_STREAM_WAIT_MS)
);

/**
 * The Live Stream's status, and the Video the recorder is open for, with
 * `liveSince`: the **Live Timer**'s start (`liveTimerStart`).
 */
export type RecorderLiveStream = {
  videoId: string;
  status: StreamStatus;
  liveSince: string | null;
};

/**
 * THE LIVE TIMER'S START (ISO): when the Live Stream first went `live` after
 * Go Live, kept through `reconnecting` and `ending`, and null once it is not
 * on. The app server stamps it, so a reload or a second tab reads the same;
 * the recorder service never hears of it. Told every status the recorder
 * reports (null: closed).
 */
const liveTimerStart = () => {
  let liveSince: string | null = null;
  return (status: StreamStatus | null) => {
    if (!isStreamOn(status)) liveSince = null;
    else if (status?.kind === "live" && liveSince === null)
      liveSince = new Date().toISOString();
    return liveSince;
  };
};

/** A state message: the recorder in `kind`, for `videoId`. */
const isStateOf = (
  m: RecorderMessage,
  kind: "open" | "recording",
  videoId: string
) => m.type === "state" && m.state.kind === kind && m.state.videoId === videoId;

/** Refuses unless `videoId` is the Video recording, as a Live Stream always is. */
const refuseUnlessLive = (state: RecorderState, videoId: string) => {
  if (state.kind !== "recording" || state.videoId !== videoId)
    throw new RecorderRefusedError("This Video is not live.");
};

/**
 * The recorder client's Live Stream commands (`client.server.ts`, ADR 0054):
 * Go Live and End Stream, each one command that waits until the recorder
 * service has carried it out.
 */
export const liveStreamCommands = (
  o: {
    /** Sends a command and waits for the message that says it was done. */
    command: (
      sent: RecorderCommand,
      done: (message: RecorderMessage) => boolean,
      extraMs?: number
    ) => Promise<void>;
    /** What a Record goes by (ADR 0038). */
    calibration: () => Promise<LastPassedCalibration | null>;
    /** The recorder service as the client last heard it. */
    recorder: () => {
      reachable: boolean;
      problem: string | null;
      state: RecorderState;
    };
  },
  stampLiveSince = liveTimerStart()
) => ({
  /**
   * The Live Stream as the recorder last said, and the Video it is open
   * for; null while it is closed or not running. Read by every page, for
   * the Live indicator (ADR 0055), after every change of the recorder's
   * state, which is when it stamps the Live Timer's start.
   */
  liveStream(): RecorderLiveStream | null {
    const { reachable, state } = o.recorder();
    // Cut off, the recorder may well be live still: the stamp is kept.
    if (!reachable) return null;
    const liveSince = stampLiveSince(
      state.kind === "closed" ? null : state.stream
    );
    return state.kind !== "closed"
      ? { videoId: state.videoId, status: state.stream, liveSince }
      : null;
  },

  /**
   * Why the recorder would refuse Go Live on `videoId` (of `format`), as
   * its state shows now: not running, not this Video's, recording, a
   * Short, the camera not live. The service adds what only it knows (the
   * screen preview's encoder, the DELL) when asked.
   */
  goLiveRefusals(videoId: string, format: VideoFormat): string[] {
    const { reachable, problem, state } = o.recorder();
    if (!reachable) return [NOT_RUNNING];
    if (problem) return [problem];
    const ours = state.kind !== "closed" && state.videoId === videoId;
    return [
      format === "short" && GO_LIVE_REFUSALS.short,
      !ours && GO_LIVE_REFUSALS.closed,
      ours && state.kind === "recording" && GO_LIVE_REFUSALS.recording,
      ours &&
        state.kind === "open" &&
        state.camera.kind !== "live" &&
        GO_LIVE_REFUSALS.cameraNotLive,
    ].filter((r) => typeof r === "string");
  },

  /**
   * GO LIVE (ADR 0054): `start-stream`, which arms the streamed writer,
   * starts the Live Stream and records, as one command. Answers once the
   * streamed Recording Session records. The Stream Key leaves its
   * `Redacted` only here, for the loopback socket.
   */
  async goLive(
    videoId: string,
    request: {
      broadcastId: string;
      streamKey: Redacted.Redacted<string>;
      micOffsetMs: number;
      micEq: MicEq;
      /** How long End Stream keeps pushing before it stops (`endStreamWaitMs`). */
      endWaitMs: number;
      silenceLength: SilenceLength;
      /** The folder (WSL path) the Recording Session's folder goes in. */
      folder: string;
    }
  ) {
    const { problem, state } = o.recorder();
    if (problem) throw new RecorderRefusedError(problem);
    if (state.kind === "closed" || state.videoId !== videoId)
      throw new RecorderRefusedError(
        "The recorder is not open for this Video."
      );
    await o.command(
      {
        type: "start-stream",
        broadcastId: request.broadcastId,
        streamKey: Redacted.value(request.streamKey),
        micOffsetMs: request.micOffsetMs,
        micEq: request.micEq,
        endWaitMs: request.endWaitMs,
        record: {
          silenceLength: request.silenceLength,
          folder: request.folder,
          calibration: await o.calibration(),
        },
      },
      (m) => isStateOf(m, "recording", videoId)
    );
  },

  /**
   * SHOW A CHAT HIGHLIGHT on the Live Stream picture (replacing any other):
   * answers with the service's stamp once the card is on the picture, which
   * the service logs and the app server saves (`ingest-chat-highlight`).
   */
  async showHighlight(
    videoId: string,
    highlight: Omit<
      Extract<RecorderCommand, { type: "show-highlight" }>,
      "type"
    >
  ): Promise<{ shownAtMs: number; clickToScreenMs: number }> {
    refuseUnlessLive(o.recorder().state, videoId);
    let answer = { shownAtMs: 0, clickToScreenMs: 0 };
    await o.command({ type: "show-highlight", ...highlight }, (m) => {
      if (
        m.type !== "chat-highlight-shown" ||
        m.highlightId !== highlight.highlightId
      )
        return false;
      answer = { shownAtMs: m.atMs, clickToScreenMs: m.atMs - m.receivedAtMs };
      return true;
    });
    return answer;
  },

  /** HIDE THE CHAT HIGHLIGHT showing: answers with the service's stamp. */
  async hideHighlight(
    videoId: string,
    highlightId: string
  ): Promise<{ hiddenAtMs: number }> {
    refuseUnlessLive(o.recorder().state, videoId);
    let hiddenAtMs = 0;
    await o.command({ type: "hide-highlight", highlightId }, (m) => {
      if (m.type !== "chat-highlight-hidden" || m.highlightId !== highlightId)
        return false;
      hiddenAtMs = m.atMs;
      return true;
    });
    return { hiddenAtMs };
  },

  /**
   * END STREAM: the push and the streamed Recording Session stop together,
   * after End Stream's wait (`endStreamWaitMs`), while the Live Stream says
   * it is ending. Answers once the push has stopped, with the Broadcast it
   * went out on.
   */
  async endStream(videoId: string): Promise<{ broadcastId: string }> {
    const { state } = o.recorder();
    if (state.kind !== "recording" || state.videoId !== videoId)
      throw new RecorderRefusedError("This Video is not live.");
    let broadcastId = "";
    await o.command(
      { type: "end-stream" },
      (m) => {
        if (m.type !== "live-stream-stopped") return false;
        broadcastId = m.broadcastId;
        return true;
      },
      LONGEST_END_STREAM_WAIT_MS
    );
    return { broadcastId };
  },
});
