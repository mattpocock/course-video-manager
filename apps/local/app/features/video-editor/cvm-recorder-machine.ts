import { setup, transition, types, type SnapshotFrom } from "xstate";
import type { SilenceLength } from "@/silence-detection-constants";
import type { VideoFormat } from "@/features/videos/video-format";
import {
  canRetryCamera,
  canWakeSpacedeskAgain,
  createInitialCvmRecorderContext,
  deviceHeard,
  framesLostInClips,
  isHeard,
  sessionEventOf,
  type cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import { isOfPlacing, placeClips } from "./cvm-recorder-clips";
import {
  NO_FRAMES_LOST_YET,
  trackFramesLost,
} from "./cvm-recorder-frames-lost";
import type { CvmRecorderMessage } from "./cvm-recorder-wire";
import { ended, type recorderSessionReducer } from "./recorder-session-reducer";
import {
  createInitialSpeechDetectorState,
  speechDetectorReducer,
} from "./speech-detector-reducer";

/**
 * The CVM recorder in the editor, as an XState machine (ADR 0050): what
 * `cvm-recorder-reducer.ts` and `recorder-session-reducer.ts` describe.
 *
 * Its state is the Recording Session's Phase: `idle` follows none,
 * `recording` and `stopping` follow one. Their state contracts make the
 * followed id null in `idle` and a string in the other two, so a transition
 * that forgets to set or clear it does not type-check. The machine is flat:
 * xstate@6.0.0-beta.3 skips a contract on a state entered through its parent
 * (statelyai/xstate#5921), so the xstate profile allows no nested states.
 *
 * One external event carries every recorder message
 * (`recorder-message-heard`). A message the editor does not follow (a late
 * replay, #2163) is unhandled, so the snapshot does not change. A message it
 * follows is raised again as the Recording Session's event, which the
 * current state handles, and then as `device-heard`, which keeps the device,
 * the frames lost and where Takes save.
 *
 * Effects are the named actions in `cvmRecorderEffects`, enqueued with their
 * data. The editor provides what they do (`use-cvm-recorder.ts`); a test reads
 * them as data from `transition()`.
 */

type Payload<U extends { type: string }, T extends U["type"]> = Omit<
  Extract<U, { type: T }>,
  "type"
>;
type Action<T extends cvmRecorderReducer.Action["type"]> = Payload<
  cvmRecorderReducer.Action,
  T
>;
type SessionEvent<T extends recorderSessionReducer.Event["type"]> = Payload<
  recorderSessionReducer.Event,
  T
>;
type Effect<T extends cvmRecorderReducer.Effect["type"]> = Payload<
  cvmRecorderReducer.Effect,
  T
>;

/**
 * Each effect the machine asks for, with its data; the editor provides what
 * it does. Each is an arrow on its own key: XState names an enqueued action
 * by its function's name, which is how `transition()` reports it.
 */
export const cvmRecorderEffects = {
  "stop-recording": (_: Effect<"stop-recording">): void => {},
  "start-session": (_: Effect<"start-session">): void => {},
  "stop-session": (_: Effect<"stop-session">): void => {},
  "start-take": (_: Effect<"start-take">): void => {},
  "close-take-window": (_: Effect<"close-take-window">): void => {},
  "send-silence-length": (_: Effect<"send-silence-length">): void => {},
  "retry-camera": (_: Effect<"retry-camera">): void => {},
  "retry-screen": (_: Effect<"retry-screen">): void => {},
  "place-take": (_: Effect<"place-take">): void => {},
  "show-saved-clips": (_: Effect<"show-saved-clips">): void => {},
};

type Effects = typeof cvmRecorderEffects;
type Context = cvmRecorderReducer.Context;
type Following = Context & { recordingSessionId: string };

/** The part of `enq` a handler shared by two states uses: named actions. */
type Enq = <F extends (effect: never) => void>(
  action: F,
  ...args: Parameters<F>
) => void;
type Args<E> = { context: Following; event: E; actions: Effects };

const recorderSetup = setup({
  schemas: {
    input: types<{ format: VideoFormat }>(),
    context: types<Context>(),
    events: {
      "recorder-message-heard": types<Action<"recorder-message-heard">>(),
      "silence-length-chosen": types<Action<"silence-length-chosen">>(),
      "press-stop": types<Action<"press-stop">>(),
      "dismiss-alert": types<Action<"dismiss-alert">>(),
      "dismiss-frames-lost-alert": types<Action<"dismiss-frames-lost-alert">>(),
      "press-retry": types<Action<"press-retry">>(),
      "press-wake-spacedesk": types<Action<"press-wake-spacedesk">>(),
      "retry-screen-failed": types<Action<"retry-screen-failed">>(),
      "retry-camera-failed": types<Action<"retry-camera-failed">>(),
      "stop-recording-failed": types<Action<"stop-recording-failed">>(),
    },
    internalEvents: {
      "recorder-reported": types<SessionEvent<"recorder-reported">>(),
      "recording-started": types<SessionEvent<"recording-started">>(),
      "recording-stopped": types<SessionEvent<"recording-stopped">>(),
      "speech-heard": types<SessionEvent<"speech-heard">>(),
      "device-heard": types<{
        message: CvmRecorderMessage;
        /** The editor follows it (`isHeard`); else only its placing hears it. */
        followed: boolean;
      }>(),
    },
  },
  actions: cvmRecorderEffects,
  states: {
    idle: {
      schemas: {
        context: types<{ recordingSessionId: null; streamed: false }>(),
      },
    },
    recording: {
      schemas: { context: types<{ recordingSessionId: string }>() },
    },
    stopping: { schemas: { context: types<{ recordingSessionId: string }>() } },
  },
});

/** Start following a Recording Session, and placing its speech. */
const follow = (
  enq: Enq,
  actions: Effects,
  recordingSessionId: string,
  silenceLength: SilenceLength
) => {
  enq(actions["start-session"], { recordingSessionId, silenceLength });
  return {
    recordingSessionId,
    placing: recordingSessionId,
    placingTake: false,
    ...NO_FRAMES_LOST_YET,
  };
};

/** The clip reducer's half of no longer following one. */
const unfollow = (context: Following, enq: Enq, actions: Effects) => {
  // Stop lets a take go at the press (#2211): the audio window of speech
  // going on closes now, as the silence after it would have closed it.
  if (context.speech.type === "speaking") enq(actions["close-take-window"], {});
  enq(actions["stop-session"], {});
};

/** The Recording Session followed is over. */
const leave = (context: Following, enq: Enq, actions: Effects) => {
  unfollow(context, enq, actions);
  return {
    speech: createInitialSpeechDetectorState(),
    recordingSessionId: null,
    endedRecordingSessionIds: ended(context, context.recordingSessionId),
    streamed: false,
  } as const;
};

/** The Recorder's word on what records now is the truth. */
const switchTo = (
  context: Following,
  enq: Enq,
  actions: Effects,
  recordingSessionId: string,
  silenceLength: SilenceLength
) => {
  unfollow(context, enq, actions);
  return {
    ...follow(enq, actions, recordingSessionId, silenceLength),
    endedRecordingSessionIds: ended(context, context.recordingSessionId),
  };
};

/**
 * Attaching (#2198): the first report a page hears while the Recorder is
 * there stops a recording a page closed mid-take left going. Never a
 * streamed one: only End Stream ends it (ADR 0055).
 */
const stopsOnAttach = (
  context: Context,
  event: SessionEvent<"recorder-reported">
) => !context.attached && event.reachable && !event.streamed;

/** The Recorder's word on what records now, while one is followed. */
const reportedWhileFollowing =
  (phase: "recording" | "stopping") =>
  (
    { context, event, actions }: Args<SessionEvent<"recorder-reported">>,
    enq: Enq
  ) => {
    const id = event.recordingSessionId;
    if (id !== null && context.endedRecordingSessionIds.includes(id)) return;
    const attached = context.attached || event.reachable;
    if (id === null)
      return {
        target: "idle",
        context: { ...leave(context, enq, actions), attached },
      } as const;
    const next = {
      ...(id === context.recordingSessionId
        ? {}
        : switchTo(context, enq, actions, id, event.silenceLength)),
      streamed: event.streamed,
      attached,
    };
    if (phase === "stopping" || !stopsOnAttach(context, event))
      return { context: next };
    enq(actions["stop-recording"], {});
    return { target: "stopping", context: next } as const;
  };

const stopped = (
  { context, actions }: Args<SessionEvent<"recording-stopped">>,
  enq: Enq
) => ({ target: "idle", context: leave(context, enq, actions) }) as const;

/** What a change of speech means for a Take. */
const speechHeard = (
  { context, event, actions }: Args<SessionEvent<"speech-heard">>,
  enq: Enq
) => {
  const before = context.speech;
  const speech = speechDetectorReducer(before, event.heard);
  if (speech === before) return;
  const sound = speech.type === "speaking" ? speech.soundDetectionId : null;
  const soundBefore =
    before.type === "speaking" ? before.soundDetectionId : null;
  if (sound !== null && sound !== soundBefore)
    enq(actions["start-take"], { soundDetectionId: sound });
  else if (before.type !== "silence" && speech.type === "silence")
    enq(actions["close-take-window"], {});
  return { context: { speech } };
};

type PlaceEffect = Parameters<typeof placeClips>[2] extends (e: infer E) => void
  ? E
  : never;

export const cvmRecorderMachine = recorderSetup.createMachine({
  id: "cvm-recorder",
  context: ({ input }) => createInitialCvmRecorderContext(input.format),
  initial: "idle",
  on: {
    "recorder-message-heard": ({ context, event }, enq) => {
      const { message } = event;
      const followed = isHeard(context, message);
      // A late replay (#2163), not even of the one still placing its speech.
      if (!followed && !isOfPlacing(context, message)) return;
      const session = followed && sessionEventOf(context, message);
      if (session) enq.raise(session);
      enq.raise({ type: "device-heard", message, followed });
    },
    "device-heard": ({ context, event, actions }, enq) => {
      const { message } = event;
      const placed: PlaceEffect[] = [];
      const next = placeClips(
        trackFramesLost(
          event.followed ? deviceHeard(context, message) : context,
          message
        ),
        message,
        (e) => placed.push(e)
      );
      for (const e of placed)
        if (e.type === "place-take") enq(actions["place-take"], e);
        else enq(actions["show-saved-clips"], e);
      // A new or restarted app server knows nothing of the editor's choice.
      if (
        message.type === "recorder-status" &&
        next.reachable === true &&
        next.silenceLength
      )
        enq(actions["send-silence-length"], {
          silenceLength: next.silenceLength,
        });
      return { context: next };
    },
    "silence-length-chosen": ({ context, event, actions }, enq) => {
      // Until the app server first answers, its recorder-status sends it.
      if (
        context.reachable === true &&
        event.silenceLength !== context.silenceLength
      )
        enq(actions["send-silence-length"], {
          silenceLength: event.silenceLength,
        });
      return { context: { silenceLength: event.silenceLength } };
    },
    "dismiss-alert": () => ({ context: { alert: null } }),
    "dismiss-frames-lost-alert": ({ context }) => ({
      context: { framesLostDismissed: framesLostInClips(context) },
    }),
    "press-retry": ({ context, actions }, enq) => {
      if (!canRetryCamera(context)) return;
      enq(actions["retry-camera"], {});
      return { context: { retrying: true, error: null } };
    },
    "retry-screen-failed": ({ event }) => ({
      context: { wakingAgain: false, error: event.message },
    }),
    "retry-camera-failed": ({ event }) => ({
      context: { retrying: false, error: event.message },
    }),
    "stop-recording-failed": ({ event }) => ({
      context: { error: event.message },
    }),
  },
  states: {
    idle: {
      on: {
        "recorder-reported": ({ context, event, actions }, enq) => {
          const id = event.recordingSessionId;
          const attached = context.attached || event.reachable;
          if (id === null) return { context: { attached } };
          if (context.endedRecordingSessionIds.includes(id)) return;
          const next = {
            ...follow(enq, actions, id, event.silenceLength),
            // Joined mid-take, nothing is known until the Recorder next hears.
            speech: createInitialSpeechDetectorState(),
            streamed: event.streamed,
            attached,
          };
          if (!stopsOnAttach(context, event))
            return { target: "recording", context: next };
          enq(actions["stop-recording"], {});
          return { target: "stopping", context: next };
        },
        "recording-started": ({ event, actions }, enq) => ({
          target: "recording",
          context: {
            ...follow(
              enq,
              actions,
              event.recordingSessionId,
              event.silenceLength
            ),
            speech: createInitialSpeechDetectorState(),
          },
        }),
        "press-wake-spacedesk": ({ context, actions }, enq) => {
          if (!canWakeSpacedeskAgain({ ...context, phase: "idle" })) return;
          enq(actions["retry-screen"], {});
          return { context: { wakingAgain: true, error: null } };
        },
      },
    },
    recording: {
      on: {
        "recorder-reported": reportedWhileFollowing("recording"),
        "recording-started": () => ({
          context: { speech: createInitialSpeechDetectorState() },
        }),
        "recording-stopped": stopped,
        "speech-heard": speechHeard,
        "press-stop": ({ actions }, enq) => {
          enq(actions["stop-recording"], {});
          return { target: "stopping" };
        },
      },
    },
    stopping: {
      on: {
        "recorder-reported": reportedWhileFollowing("stopping"),
        "recording-started": () => ({
          target: "recording",
          context: { speech: createInitialSpeechDetectorState() },
        }),
        "recording-stopped": stopped,
        "speech-heard": speechHeard,
        "stop-recording-failed": ({ event }) => ({
          target: "recording",
          context: { error: event.message },
        }),
      },
    },
  },
});

export type CvmRecorderMachine = typeof cvmRecorderMachine;
export type CvmRecorderSnapshot = SnapshotFrom<CvmRecorderMachine>;

const STATES = new WeakMap<CvmRecorderSnapshot, cvmRecorderReducer.State>();

/**
 * The recorder as its selectors read it: the context and its Phase. The same
 * snapshot always gives the same object, so a selector of a slice re-renders
 * only when that slice changes.
 */
export const recorderStateOf = (
  snapshot: CvmRecorderSnapshot
): cvmRecorderReducer.State => {
  let state = STATES.get(snapshot);
  if (!state) {
    state = { ...snapshot.context, phase: snapshot.value };
    STATES.set(snapshot, state);
  }
  return state;
};

/**
 * The machine as a pure step, for a surface that keeps the recorder's state
 * in its own reducer and runs none of its effects (the thumbnail camera,
 * `recorder-still-reducer.ts`). Its effects are dropped.
 */
export const nextRecorderState = (
  state: cvmRecorderReducer.State,
  event: cvmRecorderReducer.Action
): cvmRecorderReducer.State => {
  const { phase, ...context } = state;
  const snapshot = cvmRecorderMachine.resolveState({ value: phase, context });
  const [next] = transition(cvmRecorderMachine, snapshot, event);
  return next === snapshot ? state : recorderStateOf(next);
};
