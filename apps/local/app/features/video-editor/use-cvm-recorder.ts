import { useEffect, useRef, type RefObject } from "react";
import { useEffectReducer } from "use-effect-reducer";
import type { Scene } from "@/packages/scene-layout";
import type { MicEq } from "@cvm/core/features/videos/recorder";
import {
  resolveVideoFormat,
  type VideoFormat,
} from "@/features/videos/video-format";
import type { SilenceLength } from "@/silence-detection-constants";
import { resolveInsertionPoint } from "@/services/clip-service";
import type {
  ClipReducerAction,
  ClipReducerState,
  FrontendId,
  MicOffsetRefusal,
} from "./clip-state-reducer.types";
import {
  canRecord,
  canRetryCamera,
  canStop,
  canWakeSpacedeskAgain,
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import {
  CVM_RECORDER_MESSAGE_TYPES,
  type CvmRecorderMessage,
  type PlacedTake,
} from "./cvm-recorder-wire";

/** What the editor's CVM recorder controls show and do. */
export type CvmRecorderControls = {
  state: cvmRecorderReducer.State;
  canRecord: boolean;
  canStop: boolean;
  canRetryCamera: boolean;
  canWakeSpacedeskAgain: boolean;
  onWakeSpacedesk: () => void;
  onStop: () => void;
  onDismissAlert: () => void;
  onRetryCamera: () => void;
  /** Set (or, with null, clear) a saved CVM-recorder Clip's Scene Override. */
  onSetSceneOverride: (clipId: FrontendId, sceneOverride: Scene | null) => void;
  /** The Mic Settings dialog was saved on a CVM-recorder Clip. */
  onSubmitMicSettings: (
    clipId: FrontendId,
    settings: { micOffsetMs: number; micEq: MicEq }
  ) => void;
  /** A refused mic offset the Mic Settings dialog reopens to explain. */
  micOffsetRefusal: MicOffsetRefusal | null;
  onDismissMicOffsetRefusal: () => void;
};

const answer = async (response: Response) => {
  if (!response.ok) throw new Error(await response.text());
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Hears a Video's `CvmRecorderMessage`s from `GET /api/videos/:id/recorder/
 * events` while `enabled`. Listening is what opens the recorder (and the Cam
 * Link) for that Video, so only a CVM recorder Video may listen. The editor
 * and the thumbnail camera both listen through here.
 */
export const useRecorderEvents = (
  videoId: string,
  enabled: boolean,
  onMessage: (message: CvmRecorderMessage) => void
) => {
  const listener = useRef(onMessage);
  listener.current = onMessage;
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/videos/${videoId}/recorder/events`);
    for (const type of CVM_RECORDER_MESSAGE_TYPES) {
      source.addEventListener(type, (event) => {
        listener.current(JSON.parse(event.data) as CvmRecorderMessage);
      });
    }
    return () => source.close();
  }, [videoId, enabled]);
};

/**
 * Stop as the page goes away (#2182): a refresh, closing the tab, or leaving
 * the editor. `pagehide` gives no time for a render, so whether this editor
 * is recording is read from a ref, and Stop goes with `keepalive` to outlive
 * the page. The take is kept: Stop closes the files as the Stop button does,
 * and the app server saves every speech with or without an editor. Window
 * blur does not stop: a take is filmed with focus elsewhere, and OBS mode
 * does not stop on it either. The next page stops whatever is still going
 * (`cvmRecorderReducer`, Attaching).
 */
const useStopRecordingOnLeave = (
  videoId: string,
  enabled: boolean,
  recording: boolean
) => {
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  useEffect(() => {
    if (!enabled) return;
    const stop = () => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      fetch(`/api/videos/${videoId}/recorder/stop`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {
        // The next page's Attaching stops it.
      });
    };
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [videoId, enabled]);
};

/**
 * The effect runner for `cvmRecorderReducer`, and the bridge from the app
 * server's recorder events (`GET /api/videos/:id/recorder/events`) into it.
 * Its clip effects reach the clip reducer as the OBS path's events. Listens only on a CVM recorder Video, and its
 * listening is what opens the recorder (and the Cam Link) for that Video:
 * an OBS Video never opens it.
 */
export const useCvmRecorder = (o: {
  /** The Video: a Short opens the recorder, and draws, in the Short layout. */
  video: { id: string; format: string };
  enabled: boolean;
  silenceLength: SilenceLength;
  clipStateRef: RefObject<ClipReducerState>;
  clipDispatch: (action: ClipReducerAction) => void;
  /** OBS's callbacks: the CVM recorder's takes go through the same path. */
  onNewClipOptimisticallyAdded: (take: {
    scene: null;
    profile: null;
    soundDetectionId: string;
  }) => void;
  onClipAudioWindowClosed: () => void;
  micOffsetRefusal: MicOffsetRefusal | null;
}): CvmRecorderControls => {
  const videoId = o.video.id;
  const format: VideoFormat = resolveVideoFormat(o.video.format);
  const [state, dispatch] = useEffectReducer(
    cvmRecorderReducer,
    () => createInitialCvmRecorderState(format),
    {
      "send-silence-length": (_state, effect) => {
        fetch(`/api/videos/${videoId}/recorder/silence-length`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ silenceLength: effect.silenceLength }),
        })
          .then(answer)
          .catch((error: unknown) =>
            // Not fatal: only a Stream Deck Record needs it, and says so.
            console.error(
              "Could not tell the recorder the Silence Length",
              error
            )
          );
      },
      "start-session": (_state, effect) => {
        o.clipDispatch({
          type: "recording-started",
          outputPath: effect.recordingSessionId,
          recordingSessionId: effect.recordingSessionId,
          silenceLength: effect.silenceLength,
        });
      },
      "stop-session": () => {
        o.clipDispatch({ type: "recording-stopped" });
      },
      "start-take": (_state, effect) => {
        o.onNewClipOptimisticallyAdded({
          scene: null,
          profile: null,
          soundDetectionId: effect.soundDetectionId,
        });
      },
      "close-take-window": () => {
        o.onClipAudioWindowClosed();
      },
      "place-take": (_state, effect) => {
        // Where OBS's polling would place it: the editor's insertion point.
        const { insertionPoint, items } = o.clipStateRef.current;
        Promise.resolve()
          .then(() =>
            fetch(`/api/videos/${videoId}/recorder/place-take`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recordingSessionId: effect.recordingSessionId,
                insertionPoint: resolveInsertionPoint(insertionPoint, items),
              }),
            })
          )
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            return (await response.json()) as PlacedTake;
          })
          .then(({ clips, transcriptionJobId }) => {
            if (clips.length > 0 && transcriptionJobId)
              o.clipDispatch({
                type: "new-database-clips",
                clips,
                outputPath: effect.recordingSessionId,
                transcriptionJobId,
              });
          })
          .catch((error: unknown) =>
            // Not lost: the app server saves it after the Video's last item
            // and says so (`clips-saved`).
            console.error("Could not tell the recorder where to save", error)
          );
      },
      "show-saved-clips": (_state, effect) => {
        o.clipDispatch({
          type: "new-database-clips",
          clips: effect.clips,
          outputPath: effect.recordingSessionId,
          transcriptionJobId: effect.transcriptionJobId,
        });
      },
      "retry-camera": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/retry-camera`, {
          method: "POST",
        })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({ type: "retry-camera-failed", message: messageOf(error) })
          );
      },
      "retry-screen": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/retry-screen`, {
          method: "POST",
        })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({ type: "retry-screen-failed", message: messageOf(error) })
          );
      },
      "stop-recording": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/stop`, { method: "POST" })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({
              type: "stop-recording-failed",
              message: messageOf(error),
            })
          );
      },
    }
  );

  // Bridges the editor's Silence Length (a localStorage choice) in.
  useEffect(() => {
    if (o.enabled)
      dispatch({
        type: "silence-length-chosen",
        silenceLength: o.silenceLength,
      });
  }, [o.enabled, o.silenceLength, dispatch]);

  useStopRecordingOnLeave(videoId, o.enabled, canStop(state));

  useRecorderEvents(videoId, o.enabled, (message) => {
    dispatch({ type: "recorder-message-heard", message });
  });

  return {
    state,
    canRecord: canRecord(state),
    canStop: canStop(state),
    canRetryCamera: canRetryCamera(state),
    canWakeSpacedeskAgain: canWakeSpacedeskAgain(state),
    onWakeSpacedesk: () => dispatch({ type: "press-wake-spacedesk" }),
    onStop: () => dispatch({ type: "press-stop" }),
    onDismissAlert: () => dispatch({ type: "dismiss-alert" }),
    onRetryCamera: () => dispatch({ type: "press-retry" }),
    onSetSceneOverride: (clipId, sceneOverride) =>
      o.clipDispatch({ type: "set-scene-override", clipId, sceneOverride }),
    onSubmitMicSettings: (clipId, settings) =>
      o.clipDispatch({ type: "mic-settings-submitted", clipId, ...settings }),
    micOffsetRefusal: o.micOffsetRefusal,
    onDismissMicOffsetRefusal: () =>
      o.clipDispatch({ type: "mic-offset-refusal-dismissed" }),
  };
};
