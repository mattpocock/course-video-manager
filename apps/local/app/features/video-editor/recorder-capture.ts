import type { CaptureStatus } from "@/lib/teleprompter-protocol";
import {
  isCvmRecorderRecording,
  type cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import {
  toFrontendSpeechDetectorState,
  type FrontendSpeechDetectorState,
} from "./speech-detector-reducer";

/**
 * What a take is doing: whether it records, and what silence detection hears
 * (the recorder service's ffmpeg silencedetect, through the speech state
 * machine). Everything downstream (the editor's badge, its Silence Length
 * toggle, the teleprompter and the Diagram Playground) reads this.
 */
export type RecorderCapture = {
  isRecording: boolean;
  speech: FrontendSpeechDetectorState;
};

export const getRecorderCapture = (
  cvmRecorder: cvmRecorderReducer.State
): RecorderCapture => ({
  isRecording: isCvmRecorderRecording(cvmRecorder),
  speech: toFrontendSpeechDetectorState(cvmRecorder.speech),
});

/** The editor's capture props, from the CVM recorder's state. */
export const captureProps = (cvmRecorder: {
  state: cvmRecorderReducer.State;
}): {
  speechDetectorState: FrontendSpeechDetectorState;
  isRecordingActive: boolean;
} => {
  const capture = getRecorderCapture(cvmRecorder.state);
  return {
    speechDetectorState: capture.speech,
    isRecordingActive: capture.isRecording,
  };
};

/** The capture status the teleprompter shows on the glass. */
export const toCaptureStatus = (capture: RecorderCapture): CaptureStatus =>
  capture.isRecording ? capture.speech.type : "not-recording";
