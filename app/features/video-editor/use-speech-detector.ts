import { useEffect, useRef, useState } from "react";

export type SpeechDetectorState =
  | {
      type: "initial-silence-detected";
      silenceStartTime: number;
      lastLongEnoughSilenceEndTime: number | null;
      isLongEnoughSpeech: boolean;
    }
  | {
      type: "long-enough-silence-detected";
      silenceStartTime: number;
    }
  | {
      type: "no-silence-detected";
      speechStartTime: number;
      lastLongEnoughSilenceEndTime: number | null;
      isLongEnoughSpeech: boolean;
    };

export type FrontendSpeechDetectorState =
  | "warming-up"
  | "speaking-detected"
  | "long-enough-speaking-for-clip-detected"
  | "silence";

const SPEAKING_THRESHOLD = -33;
const LONG_ENOUGH_TIME_IN_MILLISECONDS = 800;
const LONG_ENOUGH_SPEECH_TIME_IN_MILLISECONDS = 1000;

const resolveFrontendSpeechDetectorState = (
  state: SpeechDetectorState
): FrontendSpeechDetectorState => {
  if (
    state.type === "initial-silence-detected" ||
    state.type === "no-silence-detected"
  ) {
    if (state.lastLongEnoughSilenceEndTime === null) {
      return "warming-up";
    }
    if (state.isLongEnoughSpeech) {
      return "long-enough-speaking-for-clip-detected";
    }
    return "speaking-detected";
  }

  if (state.type === "long-enough-silence-detected") {
    return "silence";
  }

  state satisfies never;

  throw new Error("Invalid speech detector state");
};

export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
}) => {
  const [state, setState] = useState<SpeechDetectorState>({
    type: "no-silence-detected",
    speechStartTime: Date.now(),
    lastLongEnoughSilenceEndTime: null,
    isLongEnoughSpeech: false,
  });

  useEffect(() => {
    if (opts.isRecording) {
      setState({
        type: "no-silence-detected",
        speechStartTime: Date.now(),
        lastLongEnoughSilenceEndTime: null,
        isLongEnoughSpeech: false,
      });
    }
  }, [opts.isRecording]);

  useEffect(() => {
    if (!opts.mediaStream) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(opts.mediaStream);
    const processor = audioContext.createScriptProcessor(1024, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      const inputBuffer = e.inputBuffer;
      const inputData = inputBuffer.getChannelData(0); // Get the first channel

      // Calculate RMS (Root Mean Square) volume
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i]! * inputData[i]!;
      }
      const rms = Math.sqrt(sum / inputData.length);

      // Convert to decibels (dB)
      const volumeDb = 20 * Math.log10(rms + 1e-10); // Add small value to avoid log(0)

      switch (state.type) {
        case "no-silence-detected": {
          if (volumeDb < SPEAKING_THRESHOLD) {
            setState({
              type: "initial-silence-detected",
              silenceStartTime: e.timeStamp,
              lastLongEnoughSilenceEndTime: state.lastLongEnoughSilenceEndTime,
              isLongEnoughSpeech: state.isLongEnoughSpeech,
            });
          } else if (
            typeof state.lastLongEnoughSilenceEndTime === "number" &&
            !state.isLongEnoughSpeech
          ) {
            const speakingTime =
              e.timeStamp - state.lastLongEnoughSilenceEndTime;
            if (speakingTime > LONG_ENOUGH_SPEECH_TIME_IN_MILLISECONDS) {
              setState({
                ...state,
                isLongEnoughSpeech: true,
              });
            }
          }

          break;
        }
        case "initial-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({
              type: "no-silence-detected",
              speechStartTime: e.timeStamp,
              lastLongEnoughSilenceEndTime: state.lastLongEnoughSilenceEndTime,
              isLongEnoughSpeech: state.isLongEnoughSpeech,
            });
          } else if (
            e.timeStamp - state.silenceStartTime >
            LONG_ENOUGH_TIME_IN_MILLISECONDS
          ) {
            setState({
              type: "long-enough-silence-detected",
              silenceStartTime: e.timeStamp,
            });
          } else if (
            typeof state.lastLongEnoughSilenceEndTime === "number" &&
            !state.isLongEnoughSpeech
          ) {
            const speakingTime =
              e.timeStamp - state.lastLongEnoughSilenceEndTime;
            if (speakingTime > LONG_ENOUGH_SPEECH_TIME_IN_MILLISECONDS) {
              setState({
                ...state,
                isLongEnoughSpeech: true,
              });
            }
          }

          break;
        }
        case "long-enough-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({
              type: "no-silence-detected",
              speechStartTime: e.timeStamp,
              lastLongEnoughSilenceEndTime: e.timeStamp,
              isLongEnoughSpeech: false,
            });
          }
          break;
        }
      }
    };

    return () => {
      source.disconnect();
      processor.disconnect();
      audioContext.close();
    };
  }, [opts.mediaStream, state]);

  return resolveFrontendSpeechDetectorState(state);
};

export const useWatchForSpeechDetected = (
  frontendSpeechDetectorState: FrontendSpeechDetectorState,
  onSpeechDetected: () => void
) => {
  const prevState = useRef<FrontendSpeechDetectorState>(
    frontendSpeechDetectorState
  );
  useEffect(() => {
    if (
      prevState.current === "long-enough-speaking-for-clip-detected" &&
      frontendSpeechDetectorState === "silence"
    ) {
      onSpeechDetected();
    }
    prevState.current = frontendSpeechDetectorState;
  }, [frontendSpeechDetectorState, onSpeechDetected]);
};
