import type { cvmRecorderReducer } from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

/**
 * Where the CVM recorder's Takes save (`cvm-recorder-reducer.ts`, Clips),
 * given the recorder state before and after a message. The Recording
 * Session and its clip effects are the shared session reducer's; this
 * places the speech of the one it last started following until its own
 * stop (`placing`), which comes after its last speech.
 */
export const placeClips = (
  before: cvmRecorderReducer.State,
  after: cvmRecorderReducer.State,
  message: CvmRecorderMessage,
  exec: (effect: cvmRecorderReducer.Effect) => void
): cvmRecorderReducer.State => {
  let placing = after.placing;
  let placingTake = after.placingTake;
  const follows = after.recordingSessionId;
  if (follows !== before.recordingSessionId && follows !== null) {
    placing = follows;
    placingTake = false;
  }

  if (
    "recordingSessionId" in message &&
    message.type !== "recorder-status" &&
    message.recordingSessionId === placing
  ) {
    switch (message.type) {
      case "take-started":
        placingTake = true;
        break;
      case "speech-ended":
        // Only a Take is saved; the app server asks about nothing else.
        if (placingTake)
          exec({ type: "place-take", recordingSessionId: placing });
        placingTake = false;
        break;
      case "clips-saved":
        exec({
          type: "show-saved-clips",
          recordingSessionId: placing,
          clips: message.clips,
          transcriptionJobId: message.transcriptionJobId,
        });
        break;
      case "recording-stopped":
      case "camera-lost":
        placing = null;
        placingTake = false;
        break;
      case "recording-started":
      case "warmed-up":
      case "speech-started":
      case "frames-lost":
        break;
    }
  }
  return placing === after.placing && placingTake === after.placingTake
    ? after
    : { ...after, placing, placingTake };
};
