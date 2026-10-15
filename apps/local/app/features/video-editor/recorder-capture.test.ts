import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createInitialCvmRecorderState } from "./cvm-recorder-reducer";
import { getRecorderCapture, toCaptureStatus } from "./recorder-capture";

describe("the capture the editor and the glass show", () => {
  const cvmRecorderSpeaking = {
    ...createInitialCvmRecorderState(),
    phase: "recording" as const,
    speech: {
      type: "speaking" as const,
      silenceEndedAtSeconds: null,
      soundDetectionId: null,
    },
  };

  it("is OBS's recording state and browser speech detector on an OBS Video", () => {
    const capture = getRecorderCapture({
      usesObs: true,
      obsState: fromPartial({ type: "obs-recording" }),
      obsSpeech: { type: "silence" },
      cvmRecorder: cvmRecorderSpeaking,
    });
    expect(toCaptureStatus(capture)).toBe("silence");
    expect(
      toCaptureStatus(
        getRecorderCapture({
          usesObs: true,
          obsState: { type: "obs-not-running" },
          obsSpeech: { type: "silence" },
          cvmRecorder: cvmRecorderSpeaking,
        })
      )
    ).toBe("not-recording");
  });

  it("is the CVM recorder's on a CVM recorder Video, whatever OBS says", () => {
    const capture = getRecorderCapture({
      usesObs: false,
      obsState: { type: "obs-not-running" },
      obsSpeech: { type: "silence" },
      cvmRecorder: cvmRecorderSpeaking,
    });
    expect(capture.isRecording).toBe(true);
    expect(toCaptureStatus(capture)).toBe("speaking-detected");
  });
});
