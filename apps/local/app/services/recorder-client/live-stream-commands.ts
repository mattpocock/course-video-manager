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
import { GO_LIVE_REFUSALS } from "recorder-service/stream-protocol";
import { NOT_RUNNING, RecorderRefusedError } from "./recorder-command";

/** A state message: the recorder in `kind`, for `videoId`. */
const isStateOf = (
  m: RecorderMessage,
  kind: "open" | "recording",
  videoId: string
) => m.type === "state" && m.state.kind === kind && m.state.videoId === videoId;

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
