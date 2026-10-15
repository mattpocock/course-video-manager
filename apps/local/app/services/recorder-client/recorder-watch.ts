import { holdWhisperWarm } from "./whisper-warmth";

/**
 * WHAT THE RECORDER IS DOING, as the app server's recorder client last heard
 * it (`kind`: closed when unreachable), and who follows it: the hold on
 * Whisper (`whisper-warmth.ts`), and the Still Gate (`still-gate.ts`), so a
 * still's decode never runs during a Recording Session.
 */
export const watchRecorder = (
  keepWhisperWarm: ((ms: number) => void) | undefined,
  kind: () => "closed" | "open" | "recording"
) => {
  const whisper = holdWhisperWarm(keepWhisperWarm, () => kind() !== "closed");
  const recording = () => kind() === "recording";
  const listeners = new Set<(recording: boolean) => void>();
  let was = false;
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
      const now = recording();
      if (now === was) return;
      was = now;
      for (const listener of [...listeners]) listener(now);
    },
    close: whisper.close,
  };
};
