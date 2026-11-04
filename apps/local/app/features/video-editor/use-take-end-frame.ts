import { useEffect, useReducer, useRef, type RefObject } from "react";
import { clipStillUrl } from "./clip-still-url";
import { stillRound, type cvmRecorderReducer } from "./cvm-recorder-reducer";
import { lastFrameSource } from "./live-preview";
import type { FrontendSpeechDetectorState } from "./speech-detector-reducer";
import {
  createInitialTakeEndFrameState,
  takeEndFrameReducer,
} from "./take-end-frame-reducer";

/**
 * The take-end frame for the last-frame overlay's Clip
 * (`take-end-frame-reducer.ts`): each time speech stops (`speaking` goes
 * false) the live preview's canvas is kept as a JPEG data URL.
 */
const useTakeEndFrame = (
  canvas: RefObject<HTMLCanvasElement | null>,
  speaking: boolean,
  clip: { id: string; takeEnd: boolean } | undefined,
  round: string
): string | undefined => {
  const [state, dispatch] = useReducer(
    takeEndFrameReducer,
    undefined,
    createInitialTakeEndFrameState
  );
  const wasSpeaking = useRef(false);

  useEffect(() => {
    if (wasSpeaking.current && !speaking) {
      let picture: string | null = null;
      try {
        picture = canvas.current?.toDataURL("image/jpeg", 0.7) ?? null;
      } catch {
        // A canvas that cannot be read keeps no picture.
      }
      dispatch({ type: "speech-ended", picture });
    }
    wasSpeaking.current = speaking;
  }, [speaking, canvas]);

  const clipId = clip?.id;
  const takeEnd = clip?.takeEnd ?? false;
  useEffect(() => {
    if (clipId) dispatch({ type: "overlay-clip-shown", clipId, takeEnd });
  }, [clipId, takeEnd]);

  useEffect(() => {
    dispatch({ type: "still-round-changed" });
  }, [round]);

  return clipId ? state.frames[clipId] : undefined;
};

/**
 * The last-frame overlay's picture for `clip` (`lastFrameSource`): its saved
 * still, its take-end frame while its Recording Session records, or none
 * (no Clip, a Live Stream, or no take-end frame kept yet).
 */
export const useLastFrameUrl = (
  canvas: RefObject<HTMLCanvasElement | null>,
  recorder: cvmRecorderReducer.State,
  speech: FrontendSpeechDetectorState,
  clip:
    | (Parameters<typeof clipStillUrl>[0] &
        Parameters<typeof lastFrameSource>[1])
    | undefined
): string | undefined => {
  const source = clip ? lastFrameSource(recorder, clip) : "none";
  const takeEndFrame = useTakeEndFrame(
    canvas,
    speech.type !== "silence" && speech.type !== "warming-up",
    clip ? { id: clip.databaseId, takeEnd: source === "take-end" } : undefined,
    stillRound(recorder)
  );
  if (source === "take-end") return takeEndFrame;
  return source === "still" && clip ? clipStillUrl(clip, "last") : undefined;
};
