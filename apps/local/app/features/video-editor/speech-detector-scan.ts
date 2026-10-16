import type { SilenceRule } from "@/silence-detection-constants";
import { createSilenceScanState, scanForSilence } from "./silence-scan";
import type { speechDetectorReducer } from "./speech-detector-reducer";

/**
 * The silence scan the OBS path's speech detector runs over the live mic,
 * turned into `speechDetectorReducer` actions. It lives as long as the mic
 * stream, so it outlives takes: a recording start restarts it, or a silence
 * heard before Record would hold `inSilence` and no `silence-started` would
 * come until speech ended it.
 */
export const createSpeechDetectorScan = (rule: SilenceRule) => {
  let scan = createSilenceScanState();
  return {
    /** Record was pressed: restart the scan with the reducer. */
    recordingStarted: (): speechDetectorReducer.Action => {
      scan = createSilenceScanState();
      return { type: "recording-started" };
    },
    /** One block of audio, one Float32Array per channel. */
    heard: (
      channels: readonly Float32Array[],
      sampleRate: number,
      opts: {
        /** `isAwaitingLongEnoughSpeech`: only then does the clock matter. */
        awaitingLongEnoughSpeech: boolean;
        newSoundDetectionId: () => string;
      }
    ): speechDetectorReducer.Action[] => {
      const result = scanForSilence(scan, channels, rule, sampleRate);
      scan = result.state;
      const actions: speechDetectorReducer.Action[] = result.events.map(
        (event) =>
          event.type === "silence-started"
            ? { type: "silence-started" }
            : { type: "silence-ended", endSeconds: event.endSeconds }
      );
      if (opts.awaitingLongEnoughSpeech) {
        actions.push({
          type: "audio-heard",
          atSeconds: scan.frames / sampleRate,
          soundDetectionId: opts.newSoundDetectionId(),
        });
      }
      return actions;
    },
  };
};

export type SpeechDetectorScan = ReturnType<typeof createSpeechDetectorScan>;
