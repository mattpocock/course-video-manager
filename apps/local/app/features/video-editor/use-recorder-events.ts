import { useEffect, useRef } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialRecorderAttentionState,
  holdsRecorder,
  recorderAttentionReducer,
} from "./recorder-attention-reducer";
import {
  CVM_RECORDER_MESSAGE_TYPES,
  type CvmRecorderMessage,
} from "./cvm-recorder-wire";

/**
 * Hears a Video's `CvmRecorderMessage`s from `GET /api/videos/:id/recorder/
 * events` while `enabled`. Listening is what opens the recorder (and the Cam
 * Link) for that Video. The editor and the thumbnail camera both listen
 * through here.
 *
 * It stops listening once the window has gone unfocused for
 * `RECORDER_AWAY_MS`, unless `recording`, and listens again when focus comes
 * back (`recorder-attention-reducer.ts`, #2383).
 */
export const useRecorderEvents = (
  videoId: string,
  enabled: boolean,
  recording: boolean,
  onMessage: (message: CvmRecorderMessage) => void
) => {
  const listener = useRef(onMessage);
  listener.current = onMessage;
  const [attention, dispatch] = useEffectReducer(
    recorderAttentionReducer,
    createInitialRecorderAttentionState,
    {
      "wait-while-away": (_state, effect, dispatch) => {
        const timer = setTimeout(
          () => dispatch({ type: "away-time-elapsed" }),
          effect.ms
        );
        return () => clearTimeout(timer);
      },
    }
  );
  const listening = enabled && holdsRecorder(attention);

  // Bridges the window's focus in.
  useEffect(() => {
    const report = () =>
      dispatch({
        type:
          document.visibilityState === "visible" && document.hasFocus()
            ? "window-focused"
            : "window-left",
      });
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    document.addEventListener("visibilitychange", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
      document.removeEventListener("visibilitychange", report);
    };
  }, [dispatch]);

  // Bridges whether a Recording Session holds the recorder in.
  useEffect(() => {
    dispatch({ type: "recording-heard", recording });
  }, [recording, dispatch]);

  useEffect(() => {
    if (!listening) return;
    const source = new EventSource(`/api/videos/${videoId}/recorder/events`);
    for (const type of CVM_RECORDER_MESSAGE_TYPES) {
      source.addEventListener(type, (event) => {
        listener.current(JSON.parse(event.data) as CvmRecorderMessage);
      });
    }
    return () => source.close();
  }, [videoId, listening]);
};
