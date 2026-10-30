import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import {
  canCapture,
  createInitialRecorderStillState,
  recorderStillReducer,
} from "./recorder-still-reducer";

const heard = (message: CvmRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const status = heard({
  type: "recorder-status",
  reachable: true,
  starting: false,
  problem: null,
  recordingSessionId: null,
  streamed: false,
  previews: {
    camera: "http://r/preview/camera",
    screen: "http://r/preview/screen",
  },
  still: "http://r/still",
});

const tester = () =>
  new ReducerTester(recorderStillReducer, createInitialRecorderStillState());

describe("the thumbnail camera", () => {
  it("takes its still from the recorder service once the camera is live", () => {
    const t = tester().send(status);
    t.send({ type: "press-capture" });
    expect(t.getEffects()).toEqual([]);

    t.send(heard({ type: "camera-went-live" }));
    expect(canCapture(t.getState())).toBe(true);
    t.send({ type: "press-capture" });
    expect(t.getEffects()).toEqual([
      { type: "take-still", url: "http://r/still" },
    ]);

    t.send({ type: "still-taken", dataUrl: "data:image/png;base64,x" });
    expect(t.getState().still).toBe("data:image/png;base64,x");
    expect(canCapture(t.getState())).toBe(false);

    t.send({ type: "press-retake" });
    expect(t.getState().still).toBeNull();
    expect(canCapture(t.getState())).toBe(true);
  });

  it("shows the recorder's reason when it cannot give a still", () => {
    const t = tester()
      .send(status)
      .send(heard({ type: "camera-went-live" }))
      .send({ type: "press-capture" })
      .send({
        type: "still-failed",
        message: "The camera has no picture yet.",
      });
    expect(t.getState()).toMatchObject({
      still: null,
      taking: false,
      error: "The camera has no picture yet.",
    });
    expect(canCapture(t.getState())).toBe(true);
  });

  it("offers Retry when the Cam Link will not start, and takes no still while recording", () => {
    const t = tester()
      .send(status)
      .send(heard({ type: "cam-link-busy", message: "Close OBS first." }));
    expect(canCapture(t.getState())).toBe(false);
    t.send({ type: "press-retry" });
    expect(t.getEffects()).toEqual([{ type: "retry-camera" }]);

    t.send(heard({ type: "camera-went-live" })).send(
      heard({
        type: "recording-started",
        recordingSessionId: "s1",
        silenceLength: "long",
        micFile: "/mic.wav",
      })
    );
    expect(canCapture(t.getState())).toBe(false);
  });
});
