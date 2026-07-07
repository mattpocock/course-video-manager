import { useEffect, useRef, useState } from "react";
import {
  SILENCE_THRESHOLD_DB,
  MINIMUM_CLIP_LENGTH_SECONDS,
  silenceLengthToSeconds,
  type SilenceLength,
} from "@/silence-detection-constants";

export type SpeechDetectorState =
  | {
      type: "initial-silence-detected";
      silenceStartTime: number;
      lastLongEnoughSilenceEndTime: number | null;
      isLongEnoughSpeech: boolean;
      soundDetectionId: string | null;
    }
  | {
      type: "long-enough-silence-detected";
      silenceStartTime: number;
    }
  | {
      type: "no-silence-detected";
      lastLongEnoughSilenceEndTime: number | null;
      isLongEnoughSpeech: boolean;
      soundDetectionId: string | null;
    };

export type FrontendSpeechDetectorState =
  | { type: "warming-up" }
  | { type: "speaking-detected" }
  | { type: "long-enough-speaking-for-clip-detected"; soundDetectionId: string }
  | { type: "silence" };

const SPEAKING_THRESHOLD = SILENCE_THRESHOLD_DB;
const LONG_ENOUGH_SPEECH_TIME_IN_MILLISECONDS =
  MINIMUM_CLIP_LENGTH_SECONDS * 1000;

const resolveFrontendSpeechDetectorState = (
  state: SpeechDetectorState
): FrontendSpeechDetectorState => {
  if (
    state.type === "initial-silence-detected" ||
    state.type === "no-silence-detected"
  ) {
    if (state.lastLongEnoughSilenceEndTime === null) {
      return { type: "warming-up" };
    }
    if (state.isLongEnoughSpeech && state.soundDetectionId) {
      return {
        type: "long-enough-speaking-for-clip-detected",
        soundDetectionId: state.soundDetectionId,
      };
    }
    return {
      type: "speaking-detected",
    };
  }

  if (state.type === "long-enough-silence-detected") {
    return { type: "silence" };
  }

  state satisfies never;

  throw new Error("Invalid speech detector state");
};

export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  silenceLength: SilenceLength;
}) => {
  const longEnoughTimeInMs = silenceLengthToSeconds(opts.silenceLength) * 1000;
  const [state, setState] = useState<SpeechDetectorState>({
    type: "no-silence-detected",
    lastLongEnoughSilenceEndTime: null,
    isLongEnoughSpeech: false,
    soundDetectionId: null,
  });

  const recordingStartTime = useRef<number | null>(null);

  useEffect(() => {
    if (opts.isRecording) {
      recordingStartTime.current = Date.now();
      setState({
        type: "no-silence-detected",
        lastLongEnoughSilenceEndTime: null,
        isLongEnoughSpeech: false,
        soundDetectionId: null,
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
              soundDetectionId: state.soundDetectionId,
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
                soundDetectionId: crypto.randomUUID(),
              });
            }
          }

          break;
        }
        case "initial-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({
              type: "no-silence-detected",
              lastLongEnoughSilenceEndTime: state.lastLongEnoughSilenceEndTime,
              isLongEnoughSpeech: state.isLongEnoughSpeech,
              soundDetectionId: state.soundDetectionId,
            });
          } else if (
            e.timeStamp - state.silenceStartTime >
            longEnoughTimeInMs
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
                soundDetectionId: crypto.randomUUID(),
              });
            }
          }

          break;
        }
        case "long-enough-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({
              type: "no-silence-detected",
              lastLongEnoughSilenceEndTime: e.timeStamp,
              isLongEnoughSpeech: false,
              soundDetectionId: null,
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
  }, [opts.mediaStream, state, longEnoughTimeInMs]);

  return resolveFrontendSpeechDetectorState(state);
};

export const useWatchForSpeechDetected = (opts: {
  state: FrontendSpeechDetectorState;
  onSpeechPartStarted: (soundDetectionId: string) => void;
}) => {
  const prevState = useRef<FrontendSpeechDetectorState>(opts.state);
  useEffect(() => {
    if (
      prevState.current.type === "speaking-detected" &&
      opts.state.type === "long-enough-speaking-for-clip-detected"
    ) {
      opts.onSpeechPartStarted(opts.state.soundDetectionId);
    }
    prevState.current = opts.state;
  }, [opts.state, opts.onSpeechPartStarted]);
};

export const useWatchForSilenceDetected = (opts: {
  state: FrontendSpeechDetectorState;
  onSilenceDetected: () => void;
}) => {
  const prevState = useRef<FrontendSpeechDetectorState>(opts.state);
  useEffect(() => {
    if (prevState.current.type !== "silence" && opts.state.type === "silence") {
      opts.onSilenceDetected();
    }
    prevState.current = opts.state;
  }, [opts.state, opts.onSilenceDetected]);
};
