import { useEffect, useRef } from "react";
import { silenceRule, type SilenceLength } from "@/silence-detection-constants";
import {
  createSpeechDetectorScan,
  type SpeechDetectorScan,
} from "./speech-detector-scan";
import {
  isAwaitingLongEnoughSpeech,
  speechDetectorReducer,
  type FrontendSpeechDetectorState,
} from "./speech-detector-reducer";

export type { FrontendSpeechDetectorState };

/**
 * The OBS path's live speech detector. The mic stream is the Recorders' own
 * mic, opened raw (`useConnectToOBSVirtualCamera`); every channel goes through
 * the silencedetect-equivalent scan, and what it hears is dispatched to
 * `speechDetectorReducer` as facts (`onHeard`), whose state the OBS
 * connector holds (`obsConnectorReducer`). Only a fact that changes it is
 * dispatched: the clock ticks every audio block, and each dispatch renders.
 * This hook only bridges the Web Audio API.
 */
export const useSpeechDetector = (opts: {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  /** The detector's state, as the connector holds it. */
  speech: speechDetectorReducer.State;
  silenceLength: SilenceLength;
  /** The silence threshold, in dB: a take's own while it records. */
  thresholdDb: number;
  onHeard: (action: speechDetectorReducer.Action) => void;
}) => {
  // Read from the audio callback, which outlives a render.
  const speech = useRef(opts.speech);
  speech.current = opts.speech;
  const onHeard = useRef(opts.onHeard);
  onHeard.current = opts.onHeard;
  const hear = (action: speechDetectorReducer.Action) => {
    const next = speechDetectorReducer(speech.current, action);
    if (next === speech.current) return;
    speech.current = next;
    onHeard.current(action);
  };
  const dispatch = useRef(hear);
  dispatch.current = hear;

  // The scan lives as long as the mic stream; Record restarts it.
  const scan = useRef<SpeechDetectorScan | null>(null);

  useEffect(() => {
    if (!opts.isRecording) return;
    dispatch.current(
      scan.current?.recordingStarted() ?? { type: "recording-started" }
    );
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
        awaitingLongEnoughSpeech: isAwaitingLongEnoughSpeech(speech.current),
        newSoundDetectionId: () => crypto.randomUUID(),
      });
      for (const action of actions) dispatch.current(action);
    };

    return () => {
      if (scan.current === liveScan) scan.current = null;
      source.disconnect();
      processor.disconnect();
      void audioContext.close();
    };
  }, [opts.mediaStream, opts.silenceLength, opts.thresholdDb]);
};
