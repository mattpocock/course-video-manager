import { useEffect } from "react";
import { useRevalidator } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import { isMicDevice, MIC_NAME } from "@/mic-device";
import {
  avCalibrationReducer,
  createInitialAVCalibrationState,
} from "./av-calibration-reducer";
import type { CalibrationTimeline } from "./calibration-timeline";
import type { SavedAVCalibration } from "./calibration-wire";
import { listenToMeter } from "./use-level-meter";
import type { ClapStepData } from "@/packages/clap-step";

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

/** How often the browser trace is handed to the reducer, in ms. */
const TRACE_BATCH_MS = 250;
/** The browser detector's block: 1024 samples, as `use-speech-detector.ts`. */
const BLOCK_FRAMES = 1024;

/**
 * The browser detector's input: the recorder's mic
 * by label, Chrome's processing off, every channel. Reports each block's peak
 * across the channels, in dBFS, a few times a second.
 */
const captureBrowserLevels = (
  dispatch: (action: avCalibrationReducer.Action) => void
) => {
  let stopped = false;
  let cleanup = () => {};
  void (async () => {
    let devices = await navigator.mediaDevices.enumerateDevices();
    // Labels come only once the page may use a mic.
    if (devices.every((d) => d.kind !== "audioinput" || !d.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const mic = devices.find(
      (d) => d.kind === "audioinput" && isMicDevice(d.label)
    );
    if (!mic)
      throw new Error(
        `${MIC_NAME} is not among the browser's audio inputs. Found: ${
          devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => d.label)
            .join(", ") || "none"
        }`
      );
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: mic.deviceId },
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: false,
        channelCount: 2,
      },
    });
    const track = stream.getAudioTracks()[0];
    if (stopped || !track) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    dispatch({ type: "browser-input-opened", label: track.label });
    const channelCount = track.getSettings().channelCount ?? 2;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(
      BLOCK_FRAMES,
      channelCount,
      1
    );
    source.connect(processor);
    processor.connect(context.destination);
    let peaks: number[] = [];
    let firstBlockEndedAtMs: number | undefined;
    let sent = 0;
    processor.onaudioprocess = (e) => {
      firstBlockEndedAtMs ??= Date.now();
      let peak = 0;
      for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) {
        for (const x of e.inputBuffer.getChannelData(c))
          peak = Math.max(peak, Math.abs(x));
      }
      peaks.push(peak > 0 ? 20 * Math.log10(peak) : -120);
    };
    const timer = setInterval(() => {
      if (peaks.length === 0 || firstBlockEndedAtMs === undefined) return;
      dispatch({
        type: "browser-levels-heard",
        firstBlockEndedAtMs,
        firstBlock: sent,
        blockSeconds: BLOCK_FRAMES / context.sampleRate,
        peaksDb: peaks,
      });
      sent += peaks.length;
      peaks = [];
    }, TRACE_BATCH_MS);
    cleanup = () => {
      clearInterval(timer);
      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    };
    if (stopped) cleanup();
  })().catch((error: unknown) =>
    dispatch({ type: "browser-input-failed", message: messageOf(error) })
  );
  return () => {
    stopped = true;
    cleanup();
  };
};

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
            console.error("Could not cancel the AV Calibration", error)
          );
      },
      "finish-calibration": (_state, effect, dispatch) => {
        const {
          calibrationId,
          scriptStartSeconds,
          windows,
          browserInputLabel,
          browserTrace,
        } = effect;
        fetch(
          "/api/av-calibration/finish",
          json({
            calibrationId,
            scriptStartSeconds,
            windows,
            browserInputLabel,
            browserTrace,
          })
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
      "capture-browser-levels": (_state, _effect, dispatch) =>
        captureBrowserLevels(dispatch),
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
