import { useEffect, useMemo, useRef, useState } from "react";
import { useActorRef, useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
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
  followedOnLeave,
  holdsRecordingSession,
  isCvmRecorderRecording,
  type cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import {
  cvmRecorderMachine,
  recorderStateOf,
  type CvmRecorderMachine,
  type cvmRecorderEffects,
} from "./cvm-recorder-machine";
import type { InsertionPoint } from "@/services/clip-service";
import { useStopRecordingOnLeave } from "./use-stop-recording-on-leave";
import { useRecorderEvents } from "./use-recorder-events";
import { cvmRecorderTakeSaver } from "./cvm-recorder-take-saver";
import type { TakeSaver } from "./take-saver";
import type { PlacedTake } from "./cvm-recorder-wire";
import type { RecorderCapture } from "./recorder-capture";
import { toFrontendSpeechDetectorState } from "./speech-detector-reducer";

export type CvmRecorderActor = ActorRefFrom<CvmRecorderMachine>;

/**
 * What the editor's CVM recorder controls show and do. The same object for
 * the whole visit: read the recorder through `actor` with a selector
 * (`useCvmRecorderSelector`), so a component re-renders only when what it
 * shows changes.
 */
export type CvmRecorderControls = {
  actor: CvmRecorderActor;
  saveTakes: TakeSaver;
  onWakeSpacedesk: () => void;
  onStop: () => void;
  onDismissAlert: () => void;
  /** Hides the frames-lost alert until a Clip loses more frames. */
  onDismissFramesLost: () => void;
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

type Options = {
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
};

const answer = async (response: Response) => {
  if (!response.ok) throw new Error(await response.text());
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * What each of the machine's effects does. Each makes one call and, where
 * the machine waits on its outcome, sends that back as an event.
 */
const recorderEffects = (
  videoId: string,
  saver: ReturnType<typeof cvmRecorderTakeSaver>,
  editor: { readonly current: Options },
  send: (event: cvmRecorderReducer.Action) => void
): typeof cvmRecorderEffects => {
  const post = (path: string, body?: unknown) =>
    fetch(`/api/videos/${videoId}/recorder/${path}`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }).then(answer);
  return {
    "send-silence-length": ({ silenceLength }) => {
      post("silence-length", { silenceLength }).catch((error: unknown) =>
        // Not fatal: only a Stream Deck Record needs it, and says so.
        console.error("Could not tell the recorder the Silence Length", error)
      );
    },
    "start-session": ({ recordingSessionId, silenceLength }) =>
      editor.current.clipDispatch({
        type: "recording-started",
        outputPath: recordingSessionId,
        silenceLength,
      }),
    "stop-session": () =>
      editor.current.clipDispatch({ type: "recording-stopped" }),
    "start-take": ({ soundDetectionId }) =>
      editor.current.onNewClipOptimisticallyAdded({
        scene: null,
        profile: null,
        soundDetectionId,
      }),
    "close-take-window": () => editor.current.onClipAudioWindowClosed(),
    "place-take": ({ recordingSessionId }) =>
      saver.takeEnded(recordingSessionId),
    "show-saved-clips": (effect) =>
      editor.current.clipDispatch({
        type: "new-database-clips",
        clips: effect.clips,
        outputPath: effect.recordingSessionId,
        transcriptionJobId: effect.transcriptionJobId,
      }),
    "retry-camera": () => {
      post("retry-camera").catch((error: unknown) =>
        send({ type: "retry-camera-failed", message: messageOf(error) })
      );
    },
    "retry-screen": () => {
      post("retry-screen").catch((error: unknown) =>
        send({ type: "retry-screen-failed", message: messageOf(error) })
      );
    },
    "stop-recording": () => {
      post("stop", {}).catch((error: unknown) =>
        send({ type: "stop-recording-failed", message: messageOf(error) })
      );
    },
  };
};

/**
 * The CVM recorder's machine (`cvm-recorder-machine.ts`), what its effects
 * do, and the bridge from the app server's recorder events
 * (`GET /api/videos/:id/recorder/events`) into it. Its clip effects are the
 * clip reducer's recording events (ADR 0044). Its listening is what opens
 * the recorder (and the Cam Link) for the Video.
 *
 * The editor subscribes to the slices it needs, not the whole snapshot: what
 * holds the recorder, the Recording Session to hand back on leave, and what
 * a take is doing (`capture`).
 */
export const useCvmRecorder = (
  o: Options
): { controls: CvmRecorderControls; capture: RecorderCapture } => {
  const videoId = o.video.id;
  const format: VideoFormat = resolveVideoFormat(o.video.format);
  const editor = useRef(o);
  editor.current = o;
  const self = useRef<CvmRecorderActor | null>(null);
  const [{ saver, logic }] = useState(() => {
    const saver = cvmRecorderTakeSaver({
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
    });
    const logic = cvmRecorderMachine.provide({
      actions: recorderEffects(videoId, saver, editor, (event) =>
        self.current?.send(event)
      ),
    });
    return { saver, logic };
  });
  const actor = useActorRef(logic, { input: { format } });
  self.current = actor;

  const following = useSelector(actor, (s) =>
    followedOnLeave(recorderStateOf(s))
  );
  const holds = useSelector(actor, (s) =>
    holdsRecordingSession(recorderStateOf(s))
  );
  const isRecording = useSelector(actor, (s) =>
    isCvmRecorderRecording(recorderStateOf(s))
  );
  const speech = useSelector(actor, (s) => s.context.speech);

  // Bridges the editor's Silence Length (a localStorage choice) in.
  useEffect(() => {
    actor.send({
      type: "silence-length-chosen",
      silenceLength: o.silenceLength,
    });
  }, [o.silenceLength, actor]);

  useStopRecordingOnLeave(following, (recordingSessionId) => {
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

  useRecorderEvents(videoId, true, holds, (message) => {
    actor.send({ type: "recorder-message-heard", message });
  });

  const micOffsetRefusal = o.micOffsetRefusal;
  const controls = useMemo(
    (): CvmRecorderControls => ({
      actor,
      saveTakes: saver.saveTakes,
      onWakeSpacedesk: () => actor.send({ type: "press-wake-spacedesk" }),
      onStop: () => actor.send({ type: "press-stop" }),
      onDismissAlert: () => actor.send({ type: "dismiss-alert" }),
      onDismissFramesLost: () =>
        actor.send({ type: "dismiss-frames-lost-alert" }),
      onRetryCamera: () => actor.send({ type: "press-retry" }),
      onSetSceneOverride: (clipId, sceneOverride) =>
        editor.current.clipDispatch({
          type: "set-scene-override",
          clipId,
          sceneOverride,
        }),
      onSubmitMicSettings: (clipId, settings) =>
        editor.current.clipDispatch({
          type: "mic-settings-submitted",
          clipId,
          ...settings,
        }),
      micOffsetRefusal,
      onDismissMicOffsetRefusal: () =>
        editor.current.clipDispatch({ type: "mic-offset-refusal-dismissed" }),
    }),
    [actor, saver, micOffsetRefusal]
  );
  const capture = useMemo(
    (): RecorderCapture => ({
      isRecording,
      speech: toFrontendSpeechDetectorState(speech),
    }),
    [isRecording, speech]
  );
  return { controls, capture };
};
