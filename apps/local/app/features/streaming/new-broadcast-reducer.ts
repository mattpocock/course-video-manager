import type { EffectReducer } from "use-effect-reducer";
import type {
  BindResult,
  Broadcast,
  LatencyPreference,
  MonetizationResult,
  NewBroadcastAnswer,
  NewBroadcastSettings,
} from "./broadcast";
import {
  newBroadcastDefaults,
  type NewBroadcastVideo,
} from "./new-stream-video";

/**
 * The **New Broadcast** form beside the Broadcast picker: its draft, the one
 * create it sends, and what the app server answered
 * (`POST /api/streaming/new-broadcast`). A created Broadcast is handed to the
 * app-wide Live Stream surface (`broadcast-created`), which picks it.
 */
export namespace newBroadcastReducer {
  export type Created = {
    broadcast: Broadcast;
    monetization: MonetizationResult;
    bind: BindResult;
  };

  export type State = {
    /** The Video the form is for: its defaults come from it. */
    video: NewBroadcastVideo;
    open: boolean;
    draft: NewBroadcastSettings;
    /** The create is out. */
    submitting: boolean;
    /** What the app server answered once the Broadcast was created. */
    created: Created | null;
    /** Why the Broadcast was not created, until the next press. */
    error: string | null;
  };

  export type Action =
    | { type: "new-broadcast-clicked" }
    | { type: "form-dismissed" }
    | { type: "title-edited"; title: string }
    | { type: "description-edited"; description: string }
    | {
        type: "privacy-picked";
        privacyStatus: NewBroadcastSettings["privacyStatus"];
      }
    | { type: "latency-picked"; latencyPreference: LatencyPreference }
    | { type: "create-clicked" }
    | { type: "create-answered"; answer: NewBroadcastAnswer }
    | { type: "create-failed"; message: string };

  export type Effect =
    | { type: "create-broadcast"; settings: NewBroadcastSettings }
    /** Hand the new Broadcast to the Live Stream surface, which picks it. */
    | { type: "pick-created-broadcast"; broadcast: Broadcast };
}

type State = newBroadcastReducer.State;
type Action = newBroadcastReducer.Action;
type Effect = newBroadcastReducer.Effect;

export const createInitialNewBroadcastState = (
  video: NewBroadcastVideo
): State => ({
  video,
  open: false,
  draft: newBroadcastDefaults(video),
  submitting: false,
  created: null,
  error: null,
});

const RECONNECT_WORDS =
  "Reconnect Google, so CVM can create the Broadcast on YouTube.";

/** Whether Create would send: a title, nothing out, nothing created yet. */
export const canCreate = (state: State) =>
  !state.submitting &&
  state.created === null &&
  state.draft.title.trim() !== "";

const edited = (state: State, draft: Partial<NewBroadcastSettings>): State =>
  state.submitting || state.created !== null
    ? state
    : { ...state, draft: { ...state.draft, ...draft } };

export const newBroadcastReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "new-broadcast-clicked":
      // A create still out keeps its form; otherwise it starts afresh.
      if (state.submitting) return { ...state, open: true };
      return { ...createInitialNewBroadcastState(state.video), open: true };
    case "form-dismissed":
      return { ...state, open: false };
    case "title-edited":
      return edited(state, { title: action.title });
    case "description-edited":
      return edited(state, { description: action.description });
    case "privacy-picked":
      return edited(state, { privacyStatus: action.privacyStatus });
    case "latency-picked":
      return edited(state, { latencyPreference: action.latencyPreference });
    case "create-clicked":
      if (!canCreate(state)) return state;
      exec({ type: "create-broadcast", settings: state.draft });
      return { ...state, submitting: true, error: null };
    case "create-answered": {
      if (!state.submitting) return state;
      const { answer } = action;
      if (answer.status === "needs-reconnect") {
        return { ...state, submitting: false, error: RECONNECT_WORDS };
      }
      exec({ type: "pick-created-broadcast", broadcast: answer.broadcast });
      return {
        ...state,
        submitting: false,
        created: {
          broadcast: answer.broadcast,
          monetization: answer.monetization,
          bind: answer.bind,
        },
      };
    }
    case "create-failed":
      if (!state.submitting) return state;
      return { ...state, submitting: false, error: action.message };
  }
};

/** One line of the report: whether it went as asked, in words. */
export type ReportLine = { ok: boolean; words: string };

const MONETIZATION_WORDS = (m: MonetizationResult): ReportLine => {
  switch (m.status) {
    case "off":
      return { ok: true, words: "Monetization: off" };
    case "not-eligible":
      return {
        ok: true,
        words:
          "Monetization: off (the channel is not in the YouTube Partner Program)",
      };
    case "failed":
      return {
        ok: false,
        words: `Monetization could not be turned off (${m.message}): turn monetization off in YouTube Studio before going live.`,
      };
  }
};

const BIND_WORDS = (b: BindResult): ReportLine =>
  b.status === "bound"
    ? { ok: true, words: "Bound to the Stream Key's stream." }
    : {
        ok: false,
        words: `Not bound to the Stream Key's stream: ${b.reason}`,
      };

/** What the form says of a created Broadcast's later steps, or null before. */
export const newBroadcastReport = (
  state: State
): { monetization: ReportLine; bind: ReportLine } | null =>
  state.created === null
    ? null
    : {
        monetization: MONETIZATION_WORDS(state.created.monetization),
        bind: BIND_WORDS(state.created.bind),
      };

/** The form's Unlist When Ended checkbox shows only for a Public Broadcast. */
export const showsUnlistWhenEnded = (state: State) =>
  state.draft.privacyStatus === "public";
