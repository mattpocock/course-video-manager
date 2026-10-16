import { describe, expect, it } from "vitest";
import { clipRecorder } from "./recorder.js";

describe("a Clip's Recorder", () => {
  it("is the CVM recorder for a Clip on a Recording Session", () => {
    expect(clipRecorder({ recordingSessionId: "session-1" })).toBe("cvm");
  });

  it("is OBS for an old Clip with no Recording Session, which keeps its Footage", () => {
    expect(clipRecorder({ recordingSessionId: null })).toBe("obs");
  });
});
