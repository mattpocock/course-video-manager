import { useEffect } from "react";
import { useRevalidator } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  avCalibrationReducer,
  createInitialAVCalibrationState,
} from "./av-calibration-reducer";
import type { CalibrationTimeline } from "./calibration-timeline";
import type { SavedAVCalibration } from "./calibration-wire";
import { listenToMeter } from "./use-level-meter";
import type { ClapStepData } from "@/packages/clap-step";
import { log } from "@/packages/log";

const json = (body: unknown = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The response, or an Error carrying the route's reason. */
const answer = async (response: Response) => {
  if (response.ok) return response;
  const text = await response.text();
  let message = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") message = parsed;
  } catch {
    // Plain text.
  }
  throw new Error(message || `${response.status} ${response.statusText}`);
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The effect runner for `avCalibrationReducer`, and the bridge that tells it
 * the page has opened.
 */
export const useAVCalibration = () => {
  const revalidator = useRevalidator();
  const [state, dispatch] = useEffectReducer(
    avCalibrationReducer,
    createInitialAVCalibrationState(),
    {
      "listen-to-meter": (_state, _effect, dispatch) => listenToMeter(dispatch),
      "start-calibration": (_state, _effect, dispatch) => {
        fetch("/api/av-calibration/start", json())
          .then(answer)
          .catch((error: unknown) =>
            dispatch({ type: "start-refused", message: messageOf(error) })
          );
      },
      "cancel-calibration": () => {
        fetch("/api/av-calibration/cancel", json())
          .then(answer)
          .catch((error: unknown) =>
            log.error("Could not cancel the AV Calibration", error)
          );
      },
      "finish-calibration": (_state, effect, dispatch) => {
        const { calibrationId, scriptStartSeconds, windows } = effect;
        fetch(
          "/api/av-calibration/finish",
          json({ calibrationId, scriptStartSeconds, windows })
        )
          .then(answer)
          .then(async (response) =>
            dispatch({
              type: "calibration-saved",
              calibrationId,
              calibration: (await response.json()) as SavedAVCalibration,
            })
          )
          .catch((error: unknown) =>
            dispatch({
              type: "calibration-not-saved",
              calibrationId,
              message: messageOf(error),
            })
          );
      },
      "load-timeline": (_state, { calibrationId }, dispatch) => {
        fetch(
          `/api/av-calibration/${encodeURIComponent(calibrationId)}/timeline`
        )
          .then(answer)
          .then(async (response) =>
            dispatch({
              type: "timeline-loaded",
              calibrationId,
              timeline: (await response.json()) as CalibrationTimeline,
            })
          )
          .catch((error: unknown) =>
            dispatch({
              type: "timeline-not-loaded",
              calibrationId,
              message: messageOf(error),
            })
          );
      },
      "load-clap-step": (_state, { calibrationId }, dispatch) => {
        fetch(
          `/api/av-calibration/${encodeURIComponent(calibrationId)}/clap-step`
        )
          .then(answer)
          .then(async (response) =>
            dispatch({
              type: "clap-step-loaded",
              calibrationId,
              data: (await response.json()) as ClapStepData,
            })
          )
          .catch((error: unknown) =>
            dispatch({
              type: "clap-step-not-loaded",
              calibrationId,
              message: messageOf(error),
            })
          );
      },
      "save-mic-offset": (_state, { calibrationId, micOffsetMs }, dispatch) => {
        fetch(
          `/api/av-calibration/${encodeURIComponent(calibrationId)}/mic-offset`,
          json({ micOffsetMs })
        )
          .then(answer)
          .then(async (response) =>
            dispatch({
              type: "mic-offset-saved",
              calibrationId,
              calibration: (await response.json()) as SavedAVCalibration,
            })
          )
          .catch((error: unknown) =>
            dispatch({
              type: "mic-offset-not-saved",
              calibrationId,
              message: messageOf(error),
            })
          );
      },
      "refresh-history": () => {
        void revalidator.revalidate();
      },
    }
  );
  useEffect(() => {
    dispatch({ type: "page-opened" });
  }, [dispatch]);
  return [state, dispatch] as const;
};
