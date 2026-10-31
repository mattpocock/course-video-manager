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
  type StreamStatus,
} from "recorder-service/stream-protocol";
import { NOT_RUNNING, RecorderRefusedError } from "./recorder-command";

/** The Live Stream's status, and the Video the recorder is open for. */
export type RecorderLiveStream = { videoId: string; status: StreamStatus };

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
export const liveStreamCommands = (o: {
  /** Sends a command and waits for the message that says it was done. */
  command: (
    sent: RecorderCommand,
    done: (message: RecorderMessage) => boolean
  ) => Promise<void>;
  /** What a Record goes by (ADR 0038). */
  calibration: () => Promise<LastPassedCalibration | null>;
  /** The recorder service as the client last heard it. */
  recorder: () => {
    reachable: boolean;
    problem: string | null;
    state: RecorderState;
  };
}) => ({
  /**
   * The Live Stream as the recorder last said, and the Video it is open
   * for; null while it is closed or not running. Read by every page, for
   * the Live indicator (ADR 0055).
   */
  liveStream(): RecorderLiveStream | null {
    const { reachable, state } = o.recorder();
    return reachable && state.kind !== "closed"
      ? { videoId: state.videoId, status: state.stream }
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

  /** END STREAM: the push and the streamed Recording Session stop together. */
  async endStream(videoId: string) {
    const { state } = o.recorder();
    if (state.kind !== "recording" || state.videoId !== videoId)
      throw new RecorderRefusedError("This Video is not live.");
    await o.command({ type: "end-stream" }, (m) =>
      isStateOf(m, "open", videoId)
    );
  },
});
