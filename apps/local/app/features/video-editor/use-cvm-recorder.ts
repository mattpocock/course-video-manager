import { useEffect, useMemo, useRef } from "react";
import { useEffectReducer } from "use-effect-reducer";
import type { Scene } from "@/packages/scene-layout";
import type { MicEq } from "@cvm/core/features/videos/recorder";
import {
  resolveVideoFormat,
  type VideoFormat,
} from "@/features/videos/video-format";
import type { SilenceLength } from "@/silence-detection-constants";
import type {
  ClipReducerAction,
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
  followedOnLeave,
} from "./cvm-recorder-reducer";
import type { InsertionPoint } from "@/services/clip-service";
import { useStopRecordingOnLeave } from "./use-stop-recording-on-leave";
import { cvmRecorderTakeSaver } from "./cvm-recorder-take-saver";
import type { TakeSaver } from "./take-saver";
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
 * Link) for that Video. The editor and the thumbnail camera both listen
 * through here.
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
 * The effect runner for `cvmRecorderReducer`, and the bridge from the app
 * server's recorder events (`GET /api/videos/:id/recorder/events`) into it.
 * Its clip effects are the clip reducer's recording events (ADR 0044). Its
 * listening is what opens the recorder (and the Cam Link) for the Video.
 */
export const useCvmRecorder = (o: {
  /** The Video: a Short opens the recorder, and draws, in the Short layout. */
  video: { id: string; format: string };
  silenceLength: SilenceLength;
  clipDispatch: (action: ClipReducerAction) => void;
  /** A Take shows as an Optimistic Clip; its audio window closes. */
  onNewClipOptimisticallyAdded: (take: {
    scene: null;
    profile: null;
    soundDetectionId: string;
  }) => void;
  onClipAudioWindowClosed: () => void;
  micOffsetRefusal: MicOffsetRefusal | null;
  /**
   * Where the editor would put a Clip now. Read as the editor goes away, so
   * the take it leaves mid-way is placed there.
   */
  insertionPoint: () => InsertionPoint;
}): CvmRecorderControls & { saveTakes: TakeSaver } => {
  const videoId = o.video.id;
  const format: VideoFormat = resolveVideoFormat(o.video.format);
  const saver = useMemo(
    () =>
      cvmRecorderTakeSaver({
        placeTake: async (recordingSessionId, insertionPoint) => {
          const response = await fetch(
            `/api/videos/${videoId}/recorder/place-take`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ recordingSessionId, insertionPoint }),
            }
          );
          if (!response.ok) throw new Error(await response.text());
          return (await response.json()) as PlacedTake;
        },
      }),
    [videoId]
  );
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
        saver.takeEnded(effect.recordingSessionId);
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
      "log-unexpected": (_state, effect) => {
        console.warn(effect.message);
      },
      "stop-recording": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
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
    dispatch({
      type: "silence-length-chosen",
      silenceLength: o.silenceLength,
    });
  }, [o.silenceLength, dispatch]);

  useStopRecordingOnLeave(followedOnLeave(state), (recordingSessionId) => {
    let insertionPoint: InsertionPoint | null = null;
    try {
      insertionPoint = o.insertionPoint();
    } catch (error) {
      // Not lost: unplaced, the app server saves it after the Video's last item.
      console.error("Could not say where the last take goes", error);
    }
    fetch(`/api/videos/${videoId}/recorder/stop`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        insertionPoint && {
          editorLeft: { recordingSessionId, insertionPoint },
        }
      ),
    }).catch(() => {
      // The next page's Attaching stops it.
    });
  });

  useRecorderEvents(videoId, true, (message) => {
    dispatch({ type: "recorder-message-heard", message });
  });

  return {
    state,
    saveTakes: saver.saveTakes,
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
