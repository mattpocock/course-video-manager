import type { SilenceLength } from "../app/silence-detection-constants";
import type { RecordingSessionEvent } from "./protocol";
import type { StreamFeedPorts } from "./stream-feeds";

/** What a writer is armed with: a Record that asks for anything else arms another. */
export type TakeSettings = {
  /** The folder (WSL path) the Recording Session's own folder goes in. */
  folder: string;
  silenceLength: SilenceLength;
  /** The silence threshold its silencedetect cuts with, in dB. */
  thresholdDb: number;
  /** The camera capture's writer relay it listens on. */
  relayPort: number;
  /**
   * A streamed Recording Session's (Go Live, ADR 0054): where the Live
   * Stream listens for its feeds. The camera writer and the screen recorder
   * then also feed it (`stream-feeds.ts`); null: neither does, and their
   * args are today's exactly.
   */
  streamed: StreamFeedPorts | null;
};

export const sameTake = (a: TakeSettings, b: TakeSettings) =>
  a.folder === b.folder &&
  a.silenceLength === b.silenceLength &&
  a.thresholdDb === b.thresholdDb &&
  a.relayPort === b.relayPort &&
  a.streamed?.camera === b.streamed?.camera &&
  a.streamed?.screen === b.streamed?.screen;

/** Why a Recording Session stopped (`recording-stopped`'s `reason`). */
export type StopReason = Extract<
  RecordingSessionEvent,
  { type: "recording-stopped" }
>["reason"];
