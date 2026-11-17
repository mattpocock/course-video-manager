import { setup, types } from "xstate";
import type { SilenceLength } from "@/silence-detection-constants";
import {
  createInitialSpeechDetectorState,
  speechDetectorReducer,
} from "./speech-detector-reducer";
import type { recorderSessionReducer } from "./recorder-session-reducer";

/**
 * The Recording Session as an XState v6 machine (PoC): the logic behind
 * `recorderSessionReducer`, which runs it with the pure `transition()`, so
 * no actor starts and every effect stays data (an emitted event).
 *
 * `idle` follows none; `following` follows one, `recording` or `stopping`.
 * Its state contract makes a followed id non-null in `following` and null
 * (and not streamed) in `idle`: a transition between them that forgets to
 * set or clear it does not type-check.
 */

type Payload<U extends { type: string }, T extends U["type"]> = Omit<
  Extract<U, { type: T }>,
  "type"
>;
type Event<T extends recorderSessionReducer.Event["type"]> = Payload<
  recorderSessionReducer.Event,
  T
>;
type Effect<T extends recorderSessionReducer.Effect["type"]> = Payload<
  recorderSessionReducer.Effect,
  T
>;

export type RecorderSessionContext = {
  speech: speechDetectorReducer.State;
  recordingSessionId: string | null;
  endedRecordingSessionIds: readonly string[];
  attached: boolean;
  streamed: boolean;
};

/** Enough to recognise any late replay; a page records far fewer. */
const ENDED_KEPT = 50;

const ended = (
  context: RecorderSessionContext,
  id: string | null
): readonly string[] =>
  id === null || context.endedRecordingSessionIds.includes(id)
    ? context.endedRecordingSessionIds
    : [...context.endedRecordingSessionIds, id].slice(-ENDED_KEPT);

const sessionSetup = setup({
  schemas: {
    context: types<RecorderSessionContext>(),
    events: {
      "recorder-reported": types<Event<"recorder-reported">>(),
      "recording-started": types<Event<"recording-started">>(),
      "recording-stopped": types<Event<"recording-stopped">>(),
      "speech-heard": types<Event<"speech-heard">>(),
      "press-stop": types<Event<"press-stop">>(),
      "stop-recording-failed": types<Event<"stop-recording-failed">>(),
    },
    /** The Recorder reported in to a page not yet attached (Attaching). */
    internalEvents: { attach: types<{}>() },
    emitted: {
      "stop-recording": types<Effect<"stop-recording">>(),
      "start-session": types<Effect<"start-session">>(),
      "stop-session": types<Effect<"stop-session">>(),
      "start-take": types<Effect<"start-take">>(),
      "close-take-window": types<Effect<"close-take-window">>(),
      "log-unexpected": types<Effect<"log-unexpected">>(),
    },
  },
  states: {
    idle: {
      schemas: {
        context: types<{ recordingSessionId: null; streamed: false }>(),
      },
    },
    following: {
      schemas: { context: types<{ recordingSessionId: string }>() },
      states: { recording: {}, stopping: {} },
    },
  },
});

type Enqueue = {
  emit: (effect: recorderSessionReducer.Effect) => void;
  raise: (event: { type: "attach" }) => void;
};

/** The followed Recording Session is over: the clip reducer's half of it. */
const leave = (
  context: RecorderSessionContext & { recordingSessionId: string },
  enq: Enqueue
) => {
  // Stop lets a take go at the press (#2211): the audio window of speech
  // going on closes now, as the silence after it would have closed it.
  if (context.speech.type === "speaking")
    enq.emit({ type: "close-take-window" });
  enq.emit({ type: "stop-session" });
  return {
    target: "idle",
    context: {
      speech: createInitialSpeechDetectorState(),
      recordingSessionId: null,
      endedRecordingSessionIds: ended(context, context.recordingSessionId),
      streamed: false,
    },
  } as const;
};

/** Attaching: the first report a page hears, if the Recorder is there. */
const attachOnFirstReport = (
  context: RecorderSessionContext,
  reachable: boolean,
  enq: Enqueue
) => {
  if (!context.attached && reachable) enq.raise({ type: "attach" });
};

/** What the Recorder reports of a page following a Recording Session. */
const reportedWhileFollowing = (
  context: RecorderSessionContext & { recordingSessionId: string },
  event: Event<"recorder-reported">,
  enq: Enqueue
) => {
  const id = event.recordingSessionId;
  if (id !== null && context.endedRecordingSessionIds.includes(id)) return;
  attachOnFirstReport(context, event.reachable, enq);
  if (id === null) return leave(context, enq);
  if (id === context.recordingSessionId)
    return { context: { streamed: event.streamed } };
  // The Recorder's word on what records now is the truth.
  const left = leave(context, enq);
  enq.emit({
    type: "start-session",
    recordingSessionId: id,
    silenceLength: event.silenceLength,
  });
  return {
    context: {
      recordingSessionId: id,
      endedRecordingSessionIds: left.context.endedRecordingSessionIds,
      streamed: event.streamed,
    },
  };
};

const startSession = (
  enq: Enqueue,
  recordingSessionId: string,
  silenceLength: SilenceLength
) => enq.emit({ type: "start-session", recordingSessionId, silenceLength });

const soundOf = (speech: speechDetectorReducer.State) =>
  speech.type === "speaking" ? speech.soundDetectionId : null;

/** What a change of speech means for a Take. */
const takeEffects = (
  before: speechDetectorReducer.State,
  after: speechDetectorReducer.State,
  enq: Enqueue
) => {
  const sound = soundOf(after);
  if (sound !== null && sound !== soundOf(before))
    enq.emit({ type: "start-take", soundDetectionId: sound });
  else if (before.type !== "silence" && after.type === "silence")
    enq.emit({ type: "close-take-window" });
};

export const recorderSessionMachine = sessionSetup.createMachine({
  id: "session",
  context: {
    speech: createInitialSpeechDetectorState(),
    recordingSessionId: null,
    endedRecordingSessionIds: [],
    attached: false,
    streamed: false,
  },
  initial: "idle",
  states: {
    idle: {
      on: {
        "recorder-reported": ({ context, event }, enq) => {
          const id = event.recordingSessionId;
          if (id !== null && context.endedRecordingSessionIds.includes(id))
            return;
          attachOnFirstReport(context, event.reachable, enq);
          if (id === null) return;
          startSession(enq, id, event.silenceLength);
          return {
            target: "following.recording",
            context: {
              recordingSessionId: id,
              // Joined mid-take, nothing is known until the Recorder next hears.
              speech: createInitialSpeechDetectorState(),
              streamed: event.streamed,
            },
          };
        },
        "recording-started": ({ context, event }, enq) => {
          const id = event.recordingSessionId;
          if (context.endedRecordingSessionIds.includes(id)) return;
          startSession(enq, id, event.silenceLength);
          return {
            target: "following.recording",
            context: {
              recordingSessionId: id,
              speech: speechDetectorReducer(context.speech, {
                type: "recording-started",
              }),
            },
          };
        },
        attach: () => ({ context: { attached: true } }),
      },
    },
    following: {
      initial: "recording",
      on: {
        "recorder-reported": ({ context, event }, enq) =>
          reportedWhileFollowing(context, event, enq),
        "recording-started": ({ context, event }) => {
          if (event.recordingSessionId !== context.recordingSessionId) return;
          return {
            target: ".recording",
            context: {
              speech: speechDetectorReducer(context.speech, {
                type: "recording-started",
              }),
            },
          };
        },
        "recording-stopped": ({ context, event }, enq) =>
          event.recordingSessionId === context.recordingSessionId
            ? leave(context, enq)
            : undefined,
        "speech-heard": ({ context, event }, enq) => {
          if (event.recordingSessionId !== context.recordingSessionId) return;
          const speech = speechDetectorReducer(context.speech, event.heard);
          if (speech === context.speech) return;
          takeEffects(context.speech, speech, enq);
          return { context: { speech } };
        },
        attach: () => ({ context: { attached: true } }),
      },
      states: {
        recording: {
          on: {
            "press-stop": (_, enq) => {
              enq.emit({ type: "stop-recording" });
              return { target: "stopping" };
            },
            // A streamed one is re-attached to: only End Stream ends it.
            attach: ({ context }, enq) => {
              if (context.streamed) return { context: { attached: true } };
              enq.emit({ type: "stop-recording" });
              return { target: "stopping", context: { attached: true } };
            },
          },
        },
        stopping: {
          on: { "stop-recording-failed": { target: "recording" } },
        },
      },
    },
  },
});
