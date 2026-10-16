import { describe, expect, it } from "vitest";
import {
  DEFAULT_SILENCE_THRESHOLD_DB,
  silenceRule,
} from "@/silence-detection-constants";
import { createSpeechDetectorScan } from "./speech-detector-scan";
import {
  createInitialSpeechDetectorState,
  isAwaitingLongEnoughSpeech,
  speechDetectorReducer,
} from "./speech-detector-reducer";

const rate = 1000;
const rule = silenceRule("short", DEFAULT_SILENCE_THRESHOLD_DB); // 0.8 s

/** Drives the scan and the reducer as `useSpeechDetector` does. */
const createDetector = () => {
  const scan = createSpeechDetectorScan(rule);
  let state = createInitialSpeechDetectorState();
  const apply = (actions: speechDetectorReducer.Action[]) => {
    for (const a of actions) state = speechDetectorReducer(state, a);
  };
  return {
    get state() {
      return state;
    },
    record: () => apply([scan.recordingStarted()]),
    hear: (seconds: number, amplitude: number) => {
      const block = 256;
      const samples = new Float32Array(Math.round(seconds * rate));
      for (let i = 0; i < samples.length; i += 50) samples[i] = amplitude;
      for (let o = 0; o < samples.length; o += block) {
        const channel = samples.subarray(o, o + block);
        apply(
          scan.heard([channel, channel], rate, {
            awaitingLongEnoughSpeech: isAwaitingLongEnoughSpeech(state),
            newSoundDetectionId: () => "id",
          })
        );
      }
    },
  };
};

describe("createSpeechDetectorScan", () => {
  it("reaches silence after Record when the quiet before Record carries on, with no speech", () => {
    const detector = createDetector();
    detector.hear(2, 0);
    expect(detector.state).toEqual({ type: "silence" });

    detector.record();
    expect(detector.state).toEqual({ type: "warming-up" });

    detector.hear(0.5, 0);
    expect(detector.state).toEqual({ type: "warming-up" });
    detector.hear(0.5, 0);
    expect(detector.state).toEqual({ type: "silence" });
  });

  it("hears speech after Record end the silence that follows it", () => {
    const detector = createDetector();
    detector.record();
    detector.hear(1, 0);
    detector.hear(1, 0.05);
    expect(detector.state).toMatchObject({ type: "speaking" });
    detector.hear(1, 0);
    expect(detector.state).toEqual({ type: "silence" });
  });
});

describe("speechDetectorReducer with no audio clock (the CVM recorder)", () => {
  it("never times the speech itself: only the Recorder's take-started makes a Take", () => {
    const hear = (
      state: speechDetectorReducer.State,
      ...actions: speechDetectorReducer.Action[]
    ) => actions.reduce(speechDetectorReducer, state);
    const speaking = hear(createInitialSpeechDetectorState(), {
      type: "silence-ended",
      endSeconds: null,
    });
    expect(isAwaitingLongEnoughSpeech(speaking)).toBe(false);
    expect(
      hear(speaking, {
        type: "audio-heard",
        atSeconds: 60,
        soundDetectionId: "x",
      })
    ).toBe(speaking);
    expect(
      hear(speaking, { type: "take-started", soundDetectionId: "s1:1" })
    ).toEqual({
      type: "speaking",
      silenceEndedAtSeconds: null,
      soundDetectionId: "s1:1",
    });
  });
});
