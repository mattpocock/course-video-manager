import { isStreamOn } from "recorder-service/stream-protocol";
import type { RecorderClientOptions } from "./client-options";
import type { RecorderLiveStream } from "./live-stream-commands";
import { holdWhisperWarm } from "./whisper-warmth";

/**
 * WHAT THE RECORDER IS DOING, as the app server's recorder client last heard
 * it (`kind`: closed when unreachable), and who follows it: the hold on
 * Whisper (`whisper-warmth.ts`); the Still Gate (`still-gate.ts`), so a
 * still's decode never runs during a Recording Session; and the Live Stream
 * (`onLiveStreamChanged`, `onStreamedSessionEnded`), so the Live indicator
 * and the Broadcast chat follow it however it ends.
 */

type Heard = {
  kind: "closed" | "open" | "recording";
  liveStream: RecorderLiveStream | null;
  /** Whether the recorder service answers: one that doesn't says nothing of its Live Stream. */
  reachable: boolean;
};

const sameLiveStream = (
  a: RecorderLiveStream | null,
  b: RecorderLiveStream | null
) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.videoId === b.videoId &&
    a.status.kind === b.status.kind &&
    (a.status.kind === "ended" ? a.status.reason : null) ===
      (b.status.kind === "ended" ? b.status.reason : null));

/** A streamed Recording Session records: the recorder recording, its Live Stream on. */
const streamedSession = (h: Heard) =>
  h.kind === "recording" &&
  h.liveStream !== null &&
  isStreamOn(h.liveStream.status);

export const watchRecorder = (
  o: Pick<
    RecorderClientOptions,
    "keepWhisperWarm" | "onLiveStreamChanged" | "onStreamedSessionEnded"
  >,
  heard: () => Heard
) => {
  const whisper = holdWhisperWarm(
    o.keepWhisperWarm,
    () => heard().kind !== "closed"
  );
  const recording = () => heard().kind === "recording";
  const listeners = new Set<(recording: boolean) => void>();
  let was = false;
  let wasLive: RecorderLiveStream | null = null;
  let wasStreamed = false;
  const liveStreamHeard = (now: Heard) => {
    if (!sameLiveStream(wasLive, now.liveStream)) {
      wasLive = now.liveStream;
      o.onLiveStreamChanged(now.liveStream);
    }
    const streamed = streamedSession(now);
    if (wasStreamed && !streamed) o.onStreamedSessionEnded();
    wasStreamed = streamed;
  };
  return {
    /** For the recorder client's own API: the Still Gate's signal. */
    signal: {
      recording,
      /** Hears each time recording starts (true) or stops (false). */
      onRecordingChange(listener: (recording: boolean) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    /** After every change of the recorder's state or reachability. */
    changed() {
      whisper.changed();
      const now = heard();
      // Cut off, the recorder may well be live still: the Live indicator
      // and the chat wait for what it says once it answers again.
      if (now.reachable) liveStreamHeard(now);
      const isRecording = now.kind === "recording";
      if (isRecording === was) return;
      was = isRecording;
      for (const listener of [...listeners]) listener(isRecording);
    },
    close: whisper.close,
  };
};
