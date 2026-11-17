import type { cvmRecorderReducer } from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

type PlaceEffect = Extract<
  cvmRecorderReducer.Effect,
  { type: "place-take" | "show-saved-clips" }
>;

/**
 * Where the CVM recorder's Takes save (`cvm-recorder-reducer.ts`, Clips),
 * given the recorder state once the Recording Session has heard the message.
 * The machine's session states start `placing` the Recording Session they
 * start following; this places its speech until its own stop, which comes
 * after its last speech.
 */
/** The message is of the Recording Session placed, followed or not. */
export const isOfPlacing = (
  state: cvmRecorderReducer.Context,
  message: CvmRecorderMessage
): boolean =>
  "recordingSessionId" in message &&
  message.type !== "recorder-status" &&
  message.recordingSessionId === state.placing;

export const placeClips = (
  state: cvmRecorderReducer.Context,
  message: CvmRecorderMessage,
  exec: (effect: PlaceEffect) => void
): cvmRecorderReducer.Context => {
  const placing = state.placing;
  if (
    !("recordingSessionId" in message) ||
    message.type === "recorder-status" ||
    message.recordingSessionId !== placing
  )
    return state;
  switch (message.type) {
    case "take-started":
      return state.placingTake ? state : { ...state, placingTake: true };
    case "speech-ended":
      // Only a Take is saved; the app server asks about nothing else.
      if (!state.placingTake) return state;
      exec({ type: "place-take", recordingSessionId: placing });
      return { ...state, placingTake: false };
    case "clips-saved":
      exec({
        type: "show-saved-clips",
        recordingSessionId: placing,
        clips: message.clips,
        transcriptionJobId: message.transcriptionJobId,
      });
      return state;
    case "recording-stopped":
    case "camera-lost":
      return { ...state, placing: null, placingTake: false };
    case "recording-started":
    case "warmed-up":
    case "speech-started":
    case "frames-lost":
      return state;
  }
};
