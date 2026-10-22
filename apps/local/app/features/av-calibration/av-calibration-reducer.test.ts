import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  CLOSE_OBS_TO_CALIBRATE,
  SCRIPT_END_SECONDS,
  SCRIPT_SCHEDULE,
} from "@/av-calibration-constants";
import {
  avCalibrationReducer,
  createInitialAVCalibrationState,
  clapStepOffsetMs,
  currentStep,
  liveClaps,
} from "./av-calibration-reducer";
import type { CalibrationTimeline } from "./calibration-timeline";
import type { SavedAVCalibration } from "./calibration-wire";

const calibration = (id: string): SavedAVCalibration => ({
  id,
  createdAt: "2026-10-12T09:00:00.000Z",
  outcome: "passed",
  judgement: { outcome: "passed" },
  noiseFloorDb: -80,
  speechLufs: -27,
  truePeakDb: -9,
  thresholdDb: -43,
  recorderMic: "Voicemeeter Out B1",
  browserInputLabel: "Voicemeeter Out B1",
  cameraDevice: "Cam Link 4K",
  clapsFound: 5,
  clapSpreadMs: 8,
  micOffsetMs: 142,
});

const timeline = (calibrationId: string): CalibrationTimeline => ({
  calibrationId,
  rule: { thresholdDb: -43, minSilenceSeconds: 0.8 },
  endSeconds: 63,
  prompts: [],
  reactionMarginSeconds: 0.75,
  browser: null,
  ffmpeg: [],
});

describe("the AV Calibration page's review timeline", () => {
  it("opens a past calibration's result and loads its timeline, ignoring a late one for a calibration it has left", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    t.send({
      type: "past-calibration-clicked",
      calibration: calibration("a"),
      latest: false,
    })
      .send({
        type: "past-calibration-clicked",
        calibration: calibration("b"),
        latest: false,
      })
      .send({
        type: "timeline-loaded",
        calibrationId: "a",
        timeline: timeline("a"),
      });
    expect(t.getEffects()).toEqual([
      { type: "load-timeline", calibrationId: "a" },
      { type: "load-timeline", calibrationId: "b" },
    ]);
    expect(t.getState().session).toMatchObject({
      kind: "result",
      calibration: { id: "b" },
      timeline: { status: "loading" },
    });

    t.send({
      type: "timeline-loaded",
      calibrationId: "b",
      timeline: timeline("b"),
    });
    expect(t.getState().session).toMatchObject({
      kind: "result",
      timeline: { status: "loaded", timeline: { calibrationId: "b" } },
    });
  });
});

describe("the AV Calibration page's session", () => {
  const reading = (seconds: number) => ({
    type: "meter-reading" as const,
    seconds,
    momentaryLufs: -30,
    shortTermLufs: -30,
    receivedAtMs: 1_000 + seconds * 1000,
  });

  it("prompts the clap between the silence and the reading, on the files' clock from where the run went live, and sends the clap window to the analysis", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({
        type: "calibration-started",
        calibrationId: "run-1",
        mic: "Voicemeeter Out B1",
        // The camera took 4.2 s to open: the files' clock began before it.
        scriptStartSeconds: 4.2,
      });

    const stepAtFile = (fileSeconds: number) => {
      t.send(reading(fileSeconds));
      return currentStep(t.getState())?.step;
    };
    expect(stepAtFile(4.3)).toMatchObject({ kind: "countdown" });
    expect(stepAtFile(4.2 + 9)).toMatchObject({ kind: "clap-ready" });
    const claps = SCRIPT_SCHEDULE.filter((s) => s.kind === "clap");
    claps.forEach((clap, i) =>
      expect(stepAtFile(4.2 + clap.startSeconds + 0.1)).toEqual({
        kind: "clap",
        clap: i + 1,
        startSeconds: clap.startSeconds,
        endSeconds: clap.endSeconds,
      })
    );
    expect(stepAtFile(4.2 + claps.at(-1)!.endSeconds + 0.1)).toMatchObject({
      kind: "read",
      line: 1,
    });

    t.send(reading(4.2 + SCRIPT_END_SECONDS));
    const finish = t.getEffects().find((e) => e.type === "finish-calibration");
    expect(finish).toMatchObject({
      calibrationId: "run-1",
      scriptStartSeconds: 4.2,
    });
    if (finish?.type !== "finish-calibration") throw new Error("no finish");
    const { windows } = finish;
    expect(windows.claps.startSeconds).toBeCloseTo(4.2 + 8, 6);
    expect(windows.claps.endSeconds).toBeCloseTo(
      4.2 + claps.at(-1)!.endSeconds + 0.75,
      6
    );
    expect(windows.silence.endSeconds).toBeLessThanOrEqual(
      windows.claps.startSeconds
    );
    expect(windows.speech[0]!.startSeconds).toBeGreaterThanOrEqual(
      windows.claps.endSeconds
    );
  });

  it("says Close OBS to calibrate when another program holds the Cam Link, starts nothing, and starts once it is freed, without a reload", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({ type: "start-refused", message: CLOSE_OBS_TO_CALIBRATE });
    expect(t.getState().session).toEqual({ kind: "camera-busy" });
    expect(t.getState().browser.capture).toBeNull();
    // Nothing ran, so nothing is measured or stored.
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-calibration",
      "capture-browser-levels",
    ]);

    // Matt closes OBS and presses Start again.
    t.resetExec().send({ type: "start-clicked" }).send({
      type: "calibration-started",
      calibrationId: "run-1",
      mic: "Voicemeeter Out B1",
      scriptStartSeconds: 3.1,
    });
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-calibration",
      "capture-browser-levels",
    ]);
    expect(t.getState().session).toMatchObject({
      kind: "running",
      calibrationId: "run-1",
    });
  });

  it("shows any other refused Start, such as a Cam Link that opens and sends nothing, as the session stopping", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    const notStarting =
      "Cam Link not starting: unplug and replug it, then press Retry.";
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({ type: "start-refused", message: notStarting });
    expect(t.getState().session).toEqual({
      kind: "failed",
      message: notStarting,
    });
  });

  it("shows the run's clap marks during the clap step only, ignoring another run's", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    const clapsAt = SCRIPT_SCHEDULE.find((s) => s.kind === "clap-ready")!;
    const readAt = SCRIPT_SCHEDULE.find((s) => s.kind === "read")!;
    const marks = [
      { audioS: 4.2 + 17.1, seen: true },
      { audioS: 4.2 + 18.6, seen: false },
    ];
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({
        type: "calibration-started",
        calibrationId: "run-1",
        mic: "Voicemeeter Out B1",
        scriptStartSeconds: 4.2,
      })
      .send(reading(4.2 + 1));
    expect(liveClaps(t.getState())).toBeNull();

    t.send(reading(4.2 + clapsAt.startSeconds + 0.1));
    expect(liveClaps(t.getState())).toEqual([]);
    t.send({ type: "calibration-claps", calibrationId: "run-1", claps: marks })
      .send({ type: "calibration-claps", calibrationId: "run-0", claps: [] })
      .send(reading(4.2 + clapsAt.startSeconds + 5));
    expect(liveClaps(t.getState())).toEqual(marks);

    t.send(reading(4.2 + readAt.startSeconds + 0.1));
    expect(liveClaps(t.getState())).toBeNull();
  });
});

describe("the AV Calibration page opening", () => {
  it("listens to the meter only once the page opens, and opened twice (Strict Mode remount) only the newest listener listens", () => {
    const first = { stop: () => {} } as never;
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    expect(t.getState().meterListener).toBeNull();
    vi.mocked(t.getExec()).mockReturnValue(first);
    t.send({ type: "page-opened" }).send({ type: "page-opened" });
    expect(t.getEffects()).toEqual([
      { type: "listen-to-meter" },
      { type: "listen-to-meter" },
    ]);
    expect(t.getExec().stop).toHaveBeenCalledWith(first);
  });
});

describe("the clap step", () => {
  const data = {
    calibrationId: "latest",
    loudestMs: 20_000,
    waveform: { startMs: 19_500, peaks: new Array(1001).fill(0) },
    micOffsetMs: 150,
  };
  const failedLoudness = (id: string): SavedAVCalibration => ({
    ...calibration(id),
    speechLufs: -21,
  });
  const opened = () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    t.send({
      type: "past-calibration-clicked",
      calibration: { ...calibration("latest"), micOffsetMs: null },
      latest: true,
    }).send({ type: "clap-step-loaded", calibrationId: "latest", data });
    return t;
  };
  const step = (t: ReturnType<typeof opened>) => {
    const session = t.getState().session;
    if (session.kind !== "result" || session.clapStep?.status !== "ready")
      throw new Error("no ready clap step");
    return session.clapStep;
  };

  it("opens only on the latest calibration, and only once its loudness check passed", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState()
    );
    t.send({
      type: "past-calibration-clicked",
      calibration: calibration("old"),
      latest: false,
    })
      .send({
        type: "past-calibration-clicked",
        calibration: failedLoudness("loud"),
        latest: true,
      })
      .send({
        type: "past-calibration-clicked",
        calibration: calibration("latest"),
        latest: true,
      });
    expect(t.getEffects()).toEqual([
      { type: "load-timeline", calibrationId: "old" },
      { type: "load-timeline", calibrationId: "loud" },
      { type: "load-timeline", calibrationId: "latest" },
      { type: "load-clap-step", calibrationId: "latest" },
    ]);
  });

  it("starts the sound at the loudest point and the video shifted by the current Mic Offset", () => {
    const s = step(opened());
    expect(s.soundMs).toBe(20_000);
    // 20 150 ms is frame 603.9…: frame 604.
    expect(s.videoFrame).toBe(604);
    expect(clapStepOffsetMs(s)).toBe(Math.round((604 * 1001) / 30 - 20_000));
  });

  it("steps the sound 1 ms and the video one frame, the offset following live, within the window", () => {
    const t = opened();
    t.send({ type: "sound-arrow-clicked", direction: 1 }).send({
      type: "video-arrow-clicked",
      direction: -1,
    });
    expect(step(t)).toMatchObject({ soundMs: 20_001, videoFrame: 603 });
    expect(clapStepOffsetMs(step(t))).toBe(
      Math.round((603 * 1001) / 30 - 20_001)
    );
    t.send({ type: "sound-handle-dragged", ms: 99_999 });
    expect(step(t).soundMs).toBe(20_500);
  });

  it("keeps Play on while the sliders move", () => {
    const t = opened();
    t.send({ type: "play-clicked" }).send({
      type: "video-handle-dragged",
      frame: 600,
    });
    expect(step(t)).toMatchObject({ playing: true, videoFrame: 600 });
    t.send({ type: "stop-clicked" });
    expect(step(t).playing).toBe(false);
  });

  it("saves the offset the sliders say, then shows the passed calibration and reloads the gate", () => {
    const t = opened();
    const offset = clapStepOffsetMs(step(t));
    t.resetExec().send({ type: "save-mic-offset-clicked" });
    expect(t.getEffects()).toEqual([
      { type: "save-mic-offset", calibrationId: "latest", micOffsetMs: offset },
    ]);
    t.send({
      type: "mic-offset-saved",
      calibrationId: "latest",
      calibration: { ...calibration("latest"), micOffsetMs: offset },
    });
    expect(t.getEffects()).toContainEqual({ type: "refresh-history" });
    expect(step(t).save).toEqual({ status: "saved", micOffsetMs: offset });
    expect(t.getState().session).toMatchObject({
      calibration: { micOffsetMs: offset, outcome: "passed" },
    });
    // Moving a slider again makes it unsaved.
    t.send({ type: "sound-arrow-clicked", direction: -1 });
    expect(step(t).save).toEqual({ status: "idle" });
  });

  it("says why a Save was refused", () => {
    const t = opened();
    t.send({ type: "save-mic-offset-clicked" }).send({
      type: "mic-offset-not-saved",
      calibrationId: "latest",
      message: "Only the latest AV Calibration's clap step can be saved",
    });
    expect(step(t).save).toMatchObject({ status: "failed" });
  });
});
