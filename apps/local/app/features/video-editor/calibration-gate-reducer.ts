import {
  calibrationValidity,
  RECORDER_CAMERA_NAME,
  type CalibrationValidity,
  type LastPassedCalibration,
} from "@/av-calibration-constants";

/**
 * THE GATE, as the editor shows it (ADR 0038): whether the CVM recorder may
 * start now, so the banner on its Record controls says why not before Record
 * is pressed. The latest AV Calibration passed under today's rules comes
 * from the loader; the clock ticks in as an event, so a calibration that
 * expires while the editor is open shows as expired.
 *
 * What the editor can see of the camera + mic pair: the camera the recorder
 * service is configured with (`RECORDER_CAMERA_NAME`). The mic only the
 * recorder service knows; it checks the pair when Record starts, and its
 * refusal says why.
 */
export namespace calibrationGateReducer {
  export type State = {
    lastPassed: LastPassedCalibration | null;
    /** The clock, in epoch ms, as last ticked in. */
    nowMs: number;
  };

  export type Action =
    | { type: "clock-ticked"; nowMs: number }
    /** The loader read the latest calibration again (a revalidation). */
    | { type: "calibration-loaded"; lastPassed: LastPassedCalibration | null };
}

export const createInitialCalibrationGateState = (o: {
  lastPassed: LastPassedCalibration | null;
  /** When the loader read it: the server's clock, so a render agrees with it. */
  checkedAtMs: number;
}): calibrationGateReducer.State => ({
  lastPassed: o.lastPassed,
  nowMs: o.checkedAtMs,
});

export const calibrationGateReducer = (
  state: calibrationGateReducer.State,
  action: calibrationGateReducer.Action
): calibrationGateReducer.State => {
  switch (action.type) {
    case "clock-ticked":
      return action.nowMs === state.nowMs
        ? state
        : { ...state, nowMs: action.nowMs };
    case "calibration-loaded":
      return action.lastPassed?.id === state.lastPassed?.id
        ? state
        : { ...state, lastPassed: action.lastPassed };
  }
};

/**
 * The CVM recorder: fresh enough, and taken on the recorder's camera (its
 * mic is the service's to check).
 */
export const cvmRecorderGate = (
  state: calibrationGateReducer.State
): CalibrationValidity =>
  calibrationValidity(
    state.lastPassed,
    { camera: RECORDER_CAMERA_NAME },
    state.nowMs
  );
