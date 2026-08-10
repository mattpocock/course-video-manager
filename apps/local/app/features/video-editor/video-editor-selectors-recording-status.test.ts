import { describe, expect, it } from "vitest";
import type { OBSConnectionOuterState } from "./obs-connector";
import { getShowRecordingSignal } from "./video-editor-selectors";

const recording: OBSConnectionOuterState = {
  type: "obs-recording",
  profile: "Landscape",
  scene: "Camera",
  latestOutputPath: "/out.mkv",
};

const connected: OBSConnectionOuterState = {
  type: "obs-connected",
  profile: "Landscape",
  scene: "Camera",
  latestOutputPath: null,
};

const notRunning: OBSConnectionOuterState = { type: "obs-not-running" };

describe("getShowRecordingSignal", () => {
  it("shows the pulsing signal while OBS is recording", () => {
    expect(getShowRecordingSignal(recording, false)).toBe(true);
  });

  it("stays hidden when OBS is connected but not recording", () => {
    expect(getShowRecordingSignal(connected, false)).toBe(false);
    expect(getShowRecordingSignal(notRunning, false)).toBe(false);
  });

  // The reason this selector exists: the glass carries the same status, and a
  // pulsing red circle on the editor is the one thing you can't stop seeing
  // while you read off the prompter.
  it("stays hidden while recording if the teleprompter is connected", () => {
    expect(getShowRecordingSignal(recording, true)).toBe(false);
  });

  // A teleprompter attached while OBS is idle must not resurrect the signal
  // when recording later starts — connectedness gates, it doesn't merely
  // toggle.
  it("stays hidden when a take starts with the teleprompter already connected", () => {
    expect(getShowRecordingSignal(connected, true)).toBe(false);
    expect(getShowRecordingSignal(recording, true)).toBe(false);
  });
});
