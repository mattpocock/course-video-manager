import { useEffect, useMemo, useReducer, useRef } from "react";
import { silenceRule, type SilenceLength } from "@/silence-detection-constants";
import {
  createSpeechDetectorScan,
  type SpeechDetectorScan,
} from "./speech-detector-scan";
import {
  createInitialSpeechDetectorState,
  isAwaitingLongEnoughSpeech,
  speechDetectorReducer,
  toFrontendSpeechDetectorState,
  type FrontendSpeechDetectorState,
} from "./speech-detector-reducer";

export type { FrontendSpeechDetectorState };

/**
 * The OBS path's live speech detector. The mic stream is the Recorders' own
 * mic, opened raw (`useConnectToOBSVirtualCamera`); every channel goes through
 * the silencedetect-equivalent scan, and what it hears is dispatched to
 * `speechDetectorReducer` as facts. This hook only bridges the Web Audio API.
 */
export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  silenceLength: SilenceLength;
  /** The silence threshold, in dB: a take's own while it records. */
  thresholdDb: number;
}) => {
  const [state, dispatch] = useReducer(
    speechDetectorReducer,
    undefined,
    createInitialSpeechDetectorState
  );

  // Read from the audio callback, which outlives a render.
  const awaitingLongEnoughSpeech = useRef(false);
  awaitingLongEnoughSpeech.current = isAwaitingLongEnoughSpeech(state);

  // The scan lives as long as the mic stream; Record restarts it.
  const scan = useRef<SpeechDetectorScan | null>(null);

  useEffect(() => {
    if (!opts.isRecording) return;
    dispatch(scan.current?.recordingStarted() ?? { type: "recording-started" });
  }, [opts.isRecording]);

  useEffect(() => {
    const track = opts.mediaStream?.getAudioTracks()[0];
    if (!opts.mediaStream || !track) return;

    const rule = silenceRule(opts.silenceLength, opts.thresholdDb);
    const channelCount = track.getSettings().channelCount ?? 2;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(opts.mediaStream);
    const processor = audioContext.createScriptProcessor(1024, channelCount, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    const liveScan = createSpeechDetectorScan(rule);
    scan.current = liveScan;
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer;
      const channels = Array.from({ length: input.numberOfChannels }, (_, c) =>
        input.getChannelData(c)
      );
      const actions = liveScan.heard(channels, input.sampleRate, {
        awaitingLongEnoughSpeech: awaitingLongEnoughSpeech.current,
        newSoundDetectionId: () => crypto.randomUUID(),
      });
      for (const action of actions) dispatch(action);
    };

    return () => {
      if (scan.current === liveScan) scan.current = null;
      source.disconnect();
      processor.disconnect();
      void audioContext.close();
    };
  }, [opts.mediaStream, opts.silenceLength, opts.thresholdDb]);

  return useMemo(() => toFrontendSpeechDetectorState(state), [state]);
};
