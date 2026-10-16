import type { CaptureStatus } from "@/lib/teleprompter-protocol";
import type { OBSConnectionOuterState } from "./obs-connector";
import {
  isCvmRecorderRecording,
  type cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import {
  toFrontendSpeechDetectorState,
  type FrontendSpeechDetectorState,
} from "./speech-detector-reducer";

/**
 * What a take is doing, whichever Recorder films it: whether it records, and
 * what silence detection hears. OBS reports both through the OBS connector
 * (its recording state and the browser speech detector); the CVM recorder
 * through `cvmRecorderReducer` (the recorder service's ffmpeg silencedetect),
 * through the same speech state machine. Everything downstream (the editor's badge, its
 * Silence Length toggle and the teleprompter) reads this, so none of it cares
 * which Recorder is in use.
 */
export type RecorderCapture = {
  isRecording: boolean;
  speech: FrontendSpeechDetectorState;
};

export const getRecorderCapture = (o: {
  usesObs: boolean;
  obsState: OBSConnectionOuterState;
  obsSpeech: FrontendSpeechDetectorState;
  cvmRecorder: cvmRecorderReducer.State;
}): RecorderCapture =>
  o.usesObs
    ? { isRecording: o.obsState.type === "obs-recording", speech: o.obsSpeech }
    : {
        isRecording: isCvmRecorderRecording(o.cvmRecorder),
        speech: toFrontendSpeechDetectorState(o.cvmRecorder.speech),
      };

/**
 * The editor's capture props, from the route's Recorder choice and its two
 * Recorders' connectors.
 */
export const captureProps = (
  choice: { usesObs: boolean },
  obs: {
    state: OBSConnectionOuterState;
    speechDetectorState: FrontendSpeechDetectorState;
  },
  cvmRecorder: { state: cvmRecorderReducer.State }
): {
  speechDetectorState: FrontendSpeechDetectorState;
  isRecordingActive: boolean;
} => {
  const capture = getRecorderCapture({
    usesObs: choice.usesObs,
    obsState: obs.state,
    obsSpeech: obs.speechDetectorState,
    cvmRecorder: cvmRecorder.state,
  });
  return {
    speechDetectorState: capture.speech,
    isRecordingActive: capture.isRecording,
  };
};

/** The capture status the teleprompter shows on the glass. */
export const toCaptureStatus = (capture: RecorderCapture): CaptureStatus =>
  capture.isRecording ? capture.speech.type : "not-recording";
