import { DEFAULT_SILENCE_LENGTH } from "@/silence-detection-constants";
import type { cvmRecorderReducer } from "./cvm-recorder-reducer";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";

const isSpeaking = (speech: cvmRecorderReducer.State["speech"]) =>
  speech.type === "speaking";

/**
 * The clip reducer's half of a message (`cvm-recorder-reducer.ts`, Clips),
 * given the recorder state before and after it.
 */
export const placeClips = (
  before: cvmRecorderReducer.State,
  after: cvmRecorderReducer.State,
  message: CvmRecorderMessage,
  exec: (effect: cvmRecorderReducer.Effect) => void
): cvmRecorderReducer.State => {
  let placing = after.placing;
  let placingTake = after.placingTake;
  const followed = before.recordingSessionId;
  const follows = after.recordingSessionId;
  if (followed !== follows) {
    if (followed !== null) {
      // Stop lets a take go at the press (#2211): its last speech-ended
      // comes once its files close, after the recorder says it is open. The
      // take's audio window closes now, as that silence would have closed
      // it; the speech is still placed when it ends (`placing`).
      if (isSpeaking(before.speech)) exec({ type: "close-take-window" });
      exec({ type: "stop-session" });
    }
    if (follows !== null && follows !== placing) {
      exec({
        type: "start-session",
        recordingSessionId: follows,
        silenceLength:
          message.type === "recording-started"
            ? message.silenceLength
            : (after.silenceLength ?? DEFAULT_SILENCE_LENGTH),
      });
      placing = follows;
      placingTake = false;
    }
  }
  // OBS's detector closes the audio window whenever it goes silent.
  if (before.speech.type !== "silence" && after.speech.type === "silence")
    exec({ type: "close-take-window" });

  if (
    "recordingSessionId" in message &&
    message.type !== "recorder-status" &&
    message.recordingSessionId === placing
  ) {
    switch (message.type) {
      case "take-started":
        // Shown only while the editor follows it: after its stop, the clip
        // reducer has no session left to show it in, and its Clip is
        // simply inserted when it comes.
        if (follows === message.recordingSessionId)
          exec({ type: "start-take", soundDetectionId: message.takeId });
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
