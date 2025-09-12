import { useEffect, useState } from "react";

export type SpeechDetectorState =
  | {
      type: "initial-silence-detected";
      silenceStartTime: number;
    }
  | {
      type: "long-enough-silence-detected";
      silenceStartTime: number;
    }
  | {
      type: "no-silence-detected";
    };

const SPEAKING_THRESHOLD = -33;
const LONG_ENOUGH_TIME_IN_MILLISECONDS = 800;

export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
}) => {
  const [state, setState] = useState<SpeechDetectorState>({
    type: "no-silence-detected",
  });

  useEffect(() => {
    if (opts.isRecording) {
      setState({
        type: "no-silence-detected",
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
            });
          }
          break;
        }
        case "initial-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({
              type: "no-silence-detected",
            });
          } else if (
            e.timeStamp - state.silenceStartTime >
            LONG_ENOUGH_TIME_IN_MILLISECONDS
          ) {
            setState({
              type: "long-enough-silence-detected",
              silenceStartTime: e.timeStamp,
            });
          }

          break;
        }
        case "long-enough-silence-detected": {
          if (volumeDb > SPEAKING_THRESHOLD) {
            setState({ type: "no-silence-detected" });
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

  return state;
};
