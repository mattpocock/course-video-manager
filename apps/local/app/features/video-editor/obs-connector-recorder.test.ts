import { describe, expect, it } from "vitest";
import {
  createInitialRecorderChoiceState,
  showsOBSChecks,
} from "./recorder-choice-reducer";
import {
  createInitialOBSConnectorState,
  obsConnectorReducer,
} from "./obs-connector-reducer";
import { CALIBRATION_VALIDITY_MS } from "@/av-calibration-constants";

const start = (usesObs: boolean) => {
  const effects: obsConnectorReducer.Effect[] = [];
  const exec = (e: obsConnectorReducer.Effect) => {
    effects.push(e);
  };
  let state = createInitialOBSConnectorState(usesObs, exec);
  const send = (action: obsConnectorReducer.Action) => {
    state = obsConnectorReducer(state, action, exec as never);
    return state.obs;
  };
  return { send, effects, state: () => state.obs };
};

const MIC = "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)";
const CALIBRATION_AT = Date.UTC(2026, 9, 12, 9);

/** What the editor knows when OBS starts: a fresh calibration, on its mic. */
const fresh = {
  lastPassed: {
    id: "calibration-1",
    createdAtMs: CALIBRATION_AT,
    thresholdDb: -43,
    recorderMic: MIC,
    browserInputLabel: MIC,
    cameraDevice: "Cam Link 4K",
  },
  browserInputLabel: MIC,
  nowMs: CALIBRATION_AT + 60_000,
  silenceLength: "short",
} as const;

const connected = {
  type: "obs-connected",
  profile: "Landscape Recording",
  scene: "Camera",
  recording: false,
} as const;

describe("the OBS connector and the Video's Recorder", () => {
  it("an OBS Video connects to OBS and follows its recording, the take keeping the threshold it started with", () => {
    const obs = start(true);
    expect(obs.effects).toEqual([{ type: "attempt-to-connect" }]);
    obs.send(connected);
    obs.effects.length = 0;
    expect(
      obs.send({ type: "recording-started", outputPath: "/a.mkv", ...fresh })
    ).toEqual({
      type: "obs-recording",
      profile: "Landscape Recording",
      scene: "Camera",
      latestOutputPath: "/a.mkv",
      silenceThresholdDb: -43,
    });
    expect(obs.effects).toEqual([
      {
        type: "start-session",
        outputPath: "/a.mkv",
        silenceLength: "short",
        silenceThresholdDb: -43,
      },
    ]);
  });

  it.each([
    ["none has passed", { ...fresh, lastPassed: null }, "none has passed"],
    [
      "it is 7 days old",
      { ...fresh, nowMs: CALIBRATION_AT + CALIBRATION_VALIDITY_MS },
      "expired on",
    ],
    [
      "the editor's mic is another",
      { ...fresh, browserInputLabel: "MacBook Pro Microphone" },
      'to "MacBook Pro Microphone"',
    ],
    [
      "it was taken on another camera than the recorder's",
      {
        ...fresh,
        lastPassed: { ...fresh.lastPassed, cameraDevice: "Elgato Facecam" },
      },
      'camera changed from "Elgato Facecam" to "Cam Link 4K"',
    ],
  ])(
    "stops a recording OBS starts when %s, and says why, until one is let through",
    (_, facts, why) => {
      const obs = start(true);
      obs.send(connected);
      obs.effects.length = 0;

      const refused = obs.send({
        type: "recording-started",
        outputPath: "/refused.mkv",
        ...facts,
      });
      expect(obs.effects).toEqual([{ type: "stop-recording" }]);
      expect(refused).toMatchObject({
        type: "obs-connected",
        calibrationRefusal: expect.stringContaining(why),
      });
      // OBS reports the stop: still connected, still saying why.
      expect(
        obs.send({ type: "recording-stopped", outputPath: "/refused.mkv" })
      ).toMatchObject({ calibrationRefusal: expect.stringContaining(why) });

      expect(
        obs.send({ type: "recording-started", outputPath: "/b.mkv", ...fresh })
      ).not.toHaveProperty("calibrationRefusal");
    }
  );

  it("a CVM recorder Video never connects to OBS and ignores what it reports", () => {
    const cvmRecorder = start(false);
    expect(cvmRecorder.effects).toEqual([]);
    cvmRecorder.send({ type: "connection-closed" });
    cvmRecorder.send({
      type: "recording-started",
      outputPath: "/a.mkv",
      ...fresh,
    });
    expect(cvmRecorder.state()).toEqual({ type: "obs-not-used" });
    expect(cvmRecorder.effects).toEqual([]);
  });

  it("switching a connected Video to the CVM recorder disconnects OBS, and back reconnects", () => {
    const video = start(true);
    video.send(connected);
    video.effects.length = 0;

    video.send({ type: "video-recorder-changed", usesObs: false });
    expect(video.state()).toEqual({ type: "obs-not-used" });
    expect(video.effects).toEqual([{ type: "disconnect" }]);

    video.effects.length = 0;
    video.send({ type: "video-recorder-changed", usesObs: true });
    expect(video.effects).toEqual([{ type: "attempt-to-connect" }]);
  });

  it("a connection that lands after switching to the CVM recorder is dropped", () => {
    const video = start(true);
    video.send({ type: "video-recorder-changed", usesObs: false });
    video.effects.length = 0;
    video.send(connected);
    expect(video.state()).toEqual({ type: "obs-not-used" });
    expect(video.effects).toEqual([{ type: "disconnect" }]);
  });

  it("an event OBS cannot send in this state is ignored and logged, never thrown", () => {
    const obs = start(true);
    obs.effects.length = 0;
    obs.send({ type: "scene-changed", scene: "Code" });
    obs.send({ type: "recording-started", outputPath: "/a.mkv", ...fresh });
    obs.send({ type: "recording-stopped", outputPath: "/a.mkv" });
    expect(obs.state()).toEqual({ type: "checking-obs-connection-status" });
    expect(obs.effects.map((e) => e.type)).toEqual([
      "log-unexpected",
      "log-unexpected",
      "log-unexpected",
    ]);
  });

  it("a Short never connects to OBS, even one that stored OBS (ADR 0037)", () => {
    const usesObs = showsOBSChecks(
      createInitialRecorderChoiceState({ format: "short", recorder: "obs" })
    );
    const short = start(usesObs);
    short.send({ type: "connection-closed" });
    expect(short.state()).toEqual({ type: "obs-not-used" });
    expect(short.effects).toEqual([]);
  });
});
