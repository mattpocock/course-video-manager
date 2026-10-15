import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createInitialCvmRecorderState } from "@/features/video-editor/cvm-recorder-reducer";
import { getRecorderCapture } from "@/features/video-editor/recorder-capture";
import { isFullScreen } from "./full-screen";
import {
  loaded,
  openPage,
  scene,
  shown,
} from "./diagram-playground-reducer-test-helpers";

const notRecording = {
  obsState: fromPartial<Parameters<typeof getRecorderCapture>[0]["obsState"]>({
    type: "obs-connected",
  }),
  obsSpeech: { type: "silence" as const },
  cvmRecorder: createInitialCvmRecorderState(),
};

// What the Video Editor pushes to the playground is the shared Recorder
// Capture's `isRecording`, so a take on either Recorder reaches it the same way.
const recorders = [
  {
    name: "OBS",
    idle: getRecorderCapture({ usesObs: true, ...notRecording }),
    recording: getRecorderCapture({
      usesObs: true,
      ...notRecording,
      obsState: fromPartial({ type: "obs-recording" }),
    }),
  },
  {
    name: "the CVM recorder",
    idle: getRecorderCapture({ usesObs: false, ...notRecording }),
    recording: getRecorderCapture({
      usesObs: false,
      ...notRecording,
      cvmRecorder: { ...notRecording.cvmRecorder, phase: "recording" },
    }),
  },
];

describe("a take starting on either Recorder", () => {
  it.each(recorders)(
    "closes the sidebar, centres the diagram and goes full screen once on $name",
    ({ idle, recording }) => {
      const tester = openPage()
        .resetExec()
        .send({
          type: "recording-status-reported",
          recording: idle.isRecording,
          format: "landscape",
          fullScreen: false,
        })
        .send({
          type: "recording-status-reported",
          recording: recording.isRecording,
          format: "landscape",
          fullScreen: false,
        })
        .send({ type: "focus-mode-changed", isFocusMode: true })
        // The heartbeat repeats the status mid-take; the author has panned,
        // and left full screen by hand.
        .send({
          type: "recording-status-reported",
          recording: recording.isRecording,
          format: "landscape",
          fullScreen: false,
        });

      expect(tester.getState().recording).toBe(true);
      expect(tester.getEffects()).toEqual([
        { type: "set-focus-mode", isFocusMode: true },
        { type: "centre-camera-after-layout", format: "landscape" },
        { type: "enter-full-screen" },
      ]);
    }
  );

  // Asking again while full screen re-shows the browser's exit notice.
  it.each(recorders)(
    "leaves a window that is already full screen alone on $name",
    ({ recording }) => {
      const tester = openPage().resetExec().send({
        type: "recording-status-reported",
        recording: recording.isRecording,
        format: "landscape",
        fullScreen: true,
      });

      expect(tester.getEffects()).not.toContainEqual({
        type: "enter-full-screen",
      });
    }
  );

  it("does not leave full screen when the take stops", () => {
    const tester = openPage()
      .send({
        type: "recording-status-reported",
        recording: true,
        format: "landscape",
        fullScreen: false,
      })
      .resetExec()
      .send({
        type: "recording-status-reported",
        recording: false,
        format: "landscape",
        fullScreen: true,
      });

    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: false },
    ]);
  });
});

describe("whether the window is already full screen", () => {
  const windowed = {
    hasFullscreenElement: false,
    displayModeFullScreen: false,
    innerWidth: 1920,
    innerHeight: 1000,
    screenWidth: 1920,
    screenHeight: 1080,
  };

  it.each([
    ["a maximised window", windowed, false],
    ["the Fullscreen API", { ...windowed, hasFullscreenElement: true }, true],
    [
      "the browser's F11, reported as display-mode",
      { ...windowed, displayModeFullScreen: true },
      true,
    ],
    [
      "the browser's F11, filling the screen",
      { ...windowed, innerHeight: 1080 },
      true,
    ],
  ])("%s", (_name, view, expected) => {
    expect(isFullScreen(view)).toBe(expected);
  });
});

describe("a take starting on a Short", () => {
  it("centres for the Short's format", () => {
    const tester = openPage().resetExec().send({
      type: "recording-status-reported",
      recording: true,
      format: "short",
      fullScreen: true,
    });

    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
      { type: "centre-camera-after-layout", format: "short" },
    ]);
  });
});

describe("the playground's Video is a Short, outside a take", () => {
  // The video editor reports its Video's format on every heartbeat, recording
  // or not, so every centring uses it — not just a take starting.
  const onAShort = () =>
    openPage().send({
      type: "recording-status-reported",
      recording: false,
      format: "short",
      fullScreen: true,
    });

  it("centres a loaded scene for the Short", () => {
    const tester = onAShort()
      .resetExec()
      .send({ type: "diagram-opened", diagramId: "d1" })
      .send(loaded("d1", scene("d1")));

    expect(tester.getEffects()).toContainEqual(
      shown("d1", scene("d1"), { format: "short" })
    );
  });

  it("recentres for the Short when asked", () => {
    const tester = onAShort().resetExec().send({ type: "recentre-requested" });

    expect(tester.getEffects()).toEqual([
      { type: "centre-camera-after-layout", format: "short" },
    ]);
  });

  it("recentres for Landscape until the video editor says otherwise", () => {
    const tester = openPage().resetExec().send({ type: "recentre-requested" });

    expect(tester.getEffects()).toEqual([
      { type: "centre-camera-after-layout", format: "landscape" },
    ]);
  });
});
