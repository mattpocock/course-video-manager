import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import { getHasLivePreview, getCvmRecorderLivePreview } from "./live-preview";
import {
  getShowLiveStream,
  getShowVideoPlayer,
} from "./video-editor-selectors";

const heard = (message: CvmRecorderMessage) =>
  ({ type: "recorder-message-heard", message }) as const;

const previews = {
  camera: "http://r/preview/camera",
  screen: "http://r/preview/screen",
};

const status = (reachable = true, recordingSessionId: string | null = null) =>
  heard({
    type: "recorder-status",
    reachable,
    starting: false,
    problem: null,
    recordingSessionId,
    streamed: false,
    previews,
    still: "http://r/still",
  });

const tester = () =>
  new ReducerTester(cvmRecorderReducer, createInitialCvmRecorderState());

/** The recorder open for this Video, in Code, with the Cam Link live. */
const open = () =>
  tester()
    .send(status())
    .send(heard({ type: "scene-changed", scene: "Code" }))
    .send(heard({ type: "camera-went-live" }));

describe("the CVM recorder in the editor's live frame", () => {
  it("fills the live frame once the recorder is open with a scene, as OBS's Virtual Camera does", () => {
    const t = tester().send(status());
    // Reachable, but the recorder has not said which scene it draws yet.
    expect(getHasLivePreview(t.getState())).toBe(false);

    t.send(heard({ type: "scene-changed", scene: "Code" }));
    expect(getCvmRecorderLivePreview(t.getState())).toEqual({
      previews,
      scene: "Code",
      format: "landscape",
      canvas: { width: 1920, height: 1080 },
      cameraShowing: false,
      cameraKey: "closed",
      showCenterLine: false,
    });

    // Paused, the live frame shows instead of the Clip player; playing, the
    // player — the same rule as an OBS Video with its Virtual Camera.
    const hasLive = getHasLivePreview(t.getState());
    expect(getShowVideoPlayer("paused", hasLive)).toBe(false);
    expect(getShowLiveStream(hasLive, "paused")).toBe(true);
    expect(getShowVideoPlayer("playing", hasLive)).toBe(true);
  });

  it("hands the frame back to the Clip player when the recorder goes away", () => {
    const t = open().send(status(false));
    expect(getHasLivePreview(t.getState())).toBe(false);
    expect(getShowVideoPlayer("paused", false)).toBe(true);
  });

  it("draws the camera once it is live, and the framing guide only in the Camera scene", () => {
    const t = open();
    expect(getCvmRecorderLivePreview(t.getState())).toMatchObject({
      cameraShowing: true,
      cameraKey: "live",
      showCenterLine: false,
    });

    t.send(heard({ type: "scene-changed", scene: "Camera" }));
    expect(getCvmRecorderLivePreview(t.getState())?.showCenterLine).toBe(true);
  });

  it("never takes the live frame on an OBS Video, whose editor never listens to the recorder", () => {
    expect(getHasLivePreview(createInitialCvmRecorderState())).toBe(false);
  });
});
