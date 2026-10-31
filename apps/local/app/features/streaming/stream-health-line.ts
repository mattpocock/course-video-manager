import type {
  StreamHealth,
  StreamStatus,
} from "recorder-service/stream-protocol";
import { isLiveOn, type liveStreamReducer } from "./live-stream-reducer";

/**
 * THE HEALTH LINE under the stream picture (spec #2445, stories 46–47): the
 * Live Stream's state, then fps, speed, dropped and duplicated frames,
 * bitrate and how many times it has reconnected, from what the Streaming
 * tab's recorder last said (`cvmRecorder.state.streamHealth`, which a Live
 * Stream's end forgets). Only while the Live Stream on this Video runs.
 */

const STATE_WORDS: Record<StreamStatus["kind"], string> = {
  idle: "",
  starting: "Starting",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  ended: "",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const streamHealthLine = (
  state: liveStreamReducer.State,
  videoId: string,
  health: StreamHealth | null
): string | null => {
  if (!state.stream || !isLiveOn(state, videoId)) return null;
  const words = STATE_WORDS[state.stream.status.kind];
  const h = health;
  if (!h) return words;
  return [
    words,
    h.fps === null ? "— fps" : `${h.fps.toFixed(1)} fps`,
    h.speed === null ? "— speed" : `${h.speed.toFixed(2)}x`,
    `${h.droppedFrames} dropped`,
    `${h.duplicatedFrames} duplicated`,
    h.bitrateKbps === null
      ? "— Mb/s"
      : `${(h.bitrateKbps / 1000).toFixed(1)} Mb/s`,
    plural(h.reconnects, "reconnect"),
  ].join(" · ");
};
