import { describe, expect, it } from "vitest";
import {
  CALIBRATION_VALIDITY_MS,
  calibrationValidity,
  deriveThreshold,
  describeCalibrationRefusal,
  judgeCalibration,
  loudnessMisses,
  MEASUREMENT_WINDOWS,
  passesCurrentRules,
  RECORDER_CAMERA_NAME,
  runMeasurementWindows,
  runSchedule,
  SCRIPT_END_SECONDS,
  SCRIPT_SCHEDULE,
  type CalibrationMeasures,
  type CalibrationMiss,
  type CurrentInputDevice,
  type LastPassedCalibration,
} from "./av-calibration-constants";

/** A take that passes everything: in band, peak under -6, its clap step saved. */
const GOOD: CalibrationMeasures = {
  speechLufs: -27,
  truePeakDb: -9,
  micOffsetMs: -47,
};

describe("judging an AV Calibration", () => {
  it("passes inside -27 LUFS ± 2, edges included, peak at or under -6 dBTP, with the clap step saved", () => {
    for (const m of [
      GOOD,
      { ...GOOD, speechLufs: -29, truePeakDb: -6 },
      { ...GOOD, speechLufs: -25, truePeakDb: -12 },
      { ...GOOD, micOffsetMs: 0 },
    ])
      expect(judgeCalibration(m)).toEqual({ outcome: "passed" });
  });

  it.each<[string, Partial<CalibrationMeasures>, CalibrationMiss[]]>([
    ["too loud", { speechLufs: -21 }, [{ kind: "too-loud", byDb: 4 }]],
    ["too quiet", { speechLufs: -30.5 }, [{ kind: "too-quiet", byDb: 1.5 }]],
    [
      "peaked",
      { truePeakDb: -4.5 },
      [{ kind: "peak-too-high", truePeakDb: -4.5, byDb: 1.5 }],
    ],
    [
      "the clap step not saved",
      { micOffsetMs: null },
      [{ kind: "no-mic-offset" }],
    ],
    [
      "everything at once, every miss listed",
      { speechLufs: -24, truePeakDb: -5, micOffsetMs: null },
      [
        { kind: "too-loud", byDb: 1 },
        { kind: "peak-too-high", truePeakDb: -5, byDb: 1 },
        { kind: "no-mic-offset" },
      ],
    ],
  ])("fails: %s", (_, change, misses) => {
    expect(judgeCalibration({ ...GOOD, ...change })).toEqual({
      outcome: "failed",
      misses,
    });
  });

  it("gates the clap step on the loudness check alone", () => {
    expect(loudnessMisses(GOOD)).toEqual([]);
    expect(loudnessMisses({ speechLufs: -21, truePeakDb: -9 })).toEqual([
      { kind: "too-loud", byDb: 4 },
    ]);
  });

  it("judges a calibration stored before the peak check without the peak", () => {
    expect(judgeCalibration({ ...GOOD, truePeakDb: null })).toEqual({
      outcome: "passed",
    });
  });

  it("sets the threshold 16 dB under the speech, unclamped across the whole band", () => {
    expect([-29, -27, -25].map(deriveThreshold)).toEqual([-45, -43, -41]);
  });
});

describe("the script", () => {
  it("runs 5 s of silence, then one clap, then two reading rounds, ending on the loud line", () => {
    const kinds = SCRIPT_SCHEDULE.map((s) =>
      s.kind === "clap" ? `clap ${s.clap}` : s.kind
    );
    expect(kinds).toEqual([
      "countdown",
      "silence",
      "clap-ready",
      "clap 1",
      "read",
      "pause",
      "read",
      "pause",
      "loud",
    ]);
    const silence = SCRIPT_SCHEDULE.find((s) => s.kind === "silence")!;
    expect(silence.endSeconds - silence.startSeconds).toBe(5);
    expect(SCRIPT_END_SECONDS).toBe(38.5);
  });

  it("measures the claps in their own window, clear of the silence and every speech window", () => {
    const { silence, speech, claps } = MEASUREMENT_WINDOWS;
    expect(claps.startSeconds).toBeGreaterThanOrEqual(silence.endSeconds);
    for (const w of speech)
      expect(
        w.endSeconds <= claps.startSeconds || w.startSeconds >= claps.endSeconds
      ).toBe(true);
    const clapSteps = SCRIPT_SCHEDULE.filter((s) => s.kind === "clap");
    expect(claps.startSeconds).toBeLessThan(clapSteps[0]!.startSeconds);
    expect(claps.endSeconds).toBeGreaterThan(clapSteps.at(-1)!.endSeconds);
  });

  it("moves the script and its windows to where a run went live", () => {
    expect(runSchedule(4.2)[0]).toEqual({
      kind: "countdown",
      startSeconds: 4.2,
      endSeconds: 4.2 + 3,
    });
    expect(runMeasurementWindows(4.2).claps).toEqual({
      startSeconds: MEASUREMENT_WINDOWS.claps.startSeconds + 4.2,
      endSeconds: MEASUREMENT_WINDOWS.claps.endSeconds + 4.2,
    });
  });
});

const AT = Date.UTC(2026, 9, 12, 9);
const MIC = "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)";
const lastPassed: LastPassedCalibration = {
  id: "c1",
  createdAtMs: AT,
  thresholdDb: -43,
  recorderMic: MIC,
  browserInputLabel: MIC,
  cameraDevice: "Cam Link 4K",
};

describe("whether a Recorder may start (the gate)", () => {
  it.each<
    [string, LastPassedCalibration | null, CurrentInputDevice, number, unknown]
  >([
    ["none yet", null, {}, AT, { kind: "none" }],
    [
      "a minute old, on the same pair",
      lastPassed,
      { recorderMic: MIC, camera: "Cam Link 4K" },
      AT + 60_000,
      null,
    ],
    [
      "the editor names the camera as the recorder is configured to find it",
      { ...lastPassed, cameraDevice: "Elgato Cam Link 4K" },
      { browserInputLabel: MIC, camera: RECORDER_CAMERA_NAME },
      AT,
      null,
    ],
    [
      "a millisecond under 7 days",
      lastPassed,
      { browserInputLabel: MIC },
      AT + CALIBRATION_VALIDITY_MS - 1,
      null,
    ],
    [
      "exactly 7 days old",
      lastPassed,
      {},
      AT + CALIBRATION_VALIDITY_MS,
      { kind: "expired", expiredAtMs: AT + CALIBRATION_VALIDITY_MS },
    ],
    [
      "the recorder's mic changed",
      lastPassed,
      { recorderMic: "Scarlett Solo USB" },
      AT,
      {
        kind: "device-changed",
        device: "recorder-mic",
        from: MIC,
        to: "Scarlett Solo USB",
      },
    ],
    [
      "the camera changed",
      lastPassed,
      { recorderMic: MIC, camera: "Elgato Facecam" },
      AT,
      {
        kind: "device-changed",
        device: "camera",
        from: "Cam Link 4K",
        to: "Elgato Facecam",
      },
    ],
    [
      "the browser has no mic open",
      lastPassed,
      { browserInputLabel: null },
      AT,
      { kind: "device-changed", device: "browser-input", from: MIC, to: null },
    ],
  ])("%s", (_, last, device, now, reason) => {
    const validity = calibrationValidity(last, device, now);
    expect(validity).toEqual(
      reason === null
        ? {
            valid: true,
            calibration: last,
            expiresAtMs: AT + CALIBRATION_VALIDITY_MS,
          }
        : { valid: false, reason }
    );
  });

  it("names a changed camera in the refusal", () => {
    expect(
      describeCalibrationRefusal({
        kind: "device-changed",
        device: "camera",
        from: "Cam Link 4K",
        to: "Elgato Facecam",
      })
    ).toBe(
      'Recording needs a fresh AV Calibration: The camera changed from "Cam Link 4K" to "Elgato Facecam" since the last one.'
    );
  });

  it("counts only a pass under today's rules: not an old -21 LUFS pass, nor one with no peak measured, nor one without the clap step", () => {
    const pass = { outcome: "passed" as const, ...GOOD };
    expect(passesCurrentRules(pass)).toBe(true);
    expect(passesCurrentRules({ ...pass, speechLufs: -21 })).toBe(false);
    expect(passesCurrentRules({ ...pass, truePeakDb: null })).toBe(false);
    expect(passesCurrentRules({ ...pass, outcome: "failed" })).toBe(false);
    expect(passesCurrentRules({ ...pass, micOffsetMs: null })).toBe(false);
  });

  it("never counts a pass from before AV Calibration (no clap measurements), however good its level", () => {
    expect(
      passesCurrentRules({
        outcome: "passed",
        speechLufs: -27,
        truePeakDb: -9,
        micOffsetMs: null,
      })
    ).toBe(false);
  });
});
