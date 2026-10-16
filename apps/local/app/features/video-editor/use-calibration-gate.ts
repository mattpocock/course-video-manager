import { useEffect, useMemo, useReducer } from "react";
import type {
  CalibrationValidity,
  LastPassedCalibration,
} from "@/av-calibration-constants";
import {
  calibrationGateReducer,
  createInitialCalibrationGateState,
  cvmRecorderGate,
} from "./calibration-gate-reducer";

/** How often the gate looks at the clock again. */
const TICK_MS = 30_000;

/** Whether the CVM recorder may start now (ADR 0038). */
export type CalibrationGate = CalibrationValidity;

/** The gate, from the loader's calibration and the clock. */
export const useCalibrationGate = (o: {
  lastPassed: LastPassedCalibration | null;
  checkedAtMs: number;
}): CalibrationGate => {
  const [state, dispatch] = useReducer(
    calibrationGateReducer,
    o,
    createInitialCalibrationGateState
  );
  // Bridges the clock in.
  useEffect(() => {
    const tick = () => dispatch({ type: "clock-ticked", nowMs: Date.now() });
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);
  // Bridges a revalidated loader in.
  useEffect(() => {
    dispatch({ type: "calibration-loaded", lastPassed: o.lastPassed });
  }, [o.lastPassed?.id]);
  return useMemo(() => cvmRecorderGate(state), [state]);
};
