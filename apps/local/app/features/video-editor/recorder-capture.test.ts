import { describe, expect, it } from "vitest";
import { createInitialCvmRecorderState } from "./cvm-recorder-reducer";
import { getRecorderCapture, toCaptureStatus } from "./recorder-capture";

describe("the capture the editor and the glass show", () => {
  it("is the CVM recorder's recording state and speech", () => {
    const capture = getRecorderCapture({
      ...createInitialCvmRecorderState(),
      phase: "recording",
      speech: {
        type: "speaking",
        soundDetectionId: null,
      },
    });
    expect(capture.isRecording).toBe(true);
    expect(toCaptureStatus(capture)).toBe("speaking-detected");
  });

  it("is not recording while the CVM recorder is idle", () => {
    expect(
      toCaptureStatus(getRecorderCapture(createInitialCvmRecorderState()))
    ).toBe("not-recording");
  });
});
