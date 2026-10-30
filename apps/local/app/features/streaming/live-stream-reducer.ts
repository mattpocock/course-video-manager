import type { EffectReducer } from "use-effect-reducer";
import {
  broadcastRefusal,
  type Broadcast,
  type BroadcastListAnswer,
  type ReconnectReason,
} from "./broadcast";

/**
 * The app-wide Live Stream surface, mounted at the app root like the Upload
 * Manager's Jobs, so what it holds survives leaving the Streaming tab. It
 * holds the Broadcast picker and the picked **Broadcast**; later tickets add
 * the Live Stream's status and health, chat and the current Chat Highlight
 * (spec #2445).
 */
export namespace liveStreamReducer {
  export type BroadcastList =
    /** Not listed yet in this tab. */
    | { status: "unlisted" }
    | { status: "listed"; broadcasts: Broadcast[] }
    | { status: "needs-reconnect"; reason: ReconnectReason }
    | { status: "failed"; message: string };

  export type State = {
    broadcastList: BroadcastList;
    /** A listing is out. */
    listing: boolean;
    pickedBroadcast: Broadcast | null;
  };

  export type Action =
    /** The Streaming tab drew the Broadcast picker. */
    | { type: "broadcast-picker-shown" }
    | { type: "refresh-broadcasts-clicked" }
    | { type: "broadcasts-answered"; answer: BroadcastListAnswer }
    | { type: "broadcast-listing-failed"; message: string }
    | { type: "broadcast-clicked"; broadcastId: string };

  export type Effect = { type: "list-broadcasts" };
}

type State = liveStreamReducer.State;
type Action = liveStreamReducer.Action;
type Effect = liveStreamReducer.Effect;

export const createInitialLiveStreamState = (): State => ({
  broadcastList: { status: "unlisted" },
  listing: false,
  pickedBroadcast: null,
});

export const liveStreamReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "broadcast-picker-shown":
      // A list already shown stays until Matt asks for a refresh.
      if (state.listing || state.broadcastList.status === "listed") {
        return state;
      }
      exec({ type: "list-broadcasts" });
      return { ...state, listing: true };
    case "refresh-broadcasts-clicked":
      if (state.listing) return state;
      exec({ type: "list-broadcasts" });
      return { ...state, listing: true };
    case "broadcasts-answered": {
      const { answer } = action;
      if (answer.status === "needs-reconnect") {
        return {
          ...state,
          listing: false,
          broadcastList: { status: "needs-reconnect", reason: answer.reason },
        };
      }
      // The picked Broadcast follows YouTube's latest word on it; once it is
      // no longer upcoming or active it can't be streamed to.
      const picked = state.pickedBroadcast;
      return {
        ...state,
        listing: false,
        broadcastList: { status: "listed", broadcasts: answer.broadcasts },
        pickedBroadcast:
          picked === null
            ? null
            : (answer.broadcasts.find((b) => b.id === picked.id) ?? null),
      };
    }
    case "broadcast-listing-failed":
      return {
        ...state,
        listing: false,
        broadcastList: { status: "failed", message: action.message },
      };
    case "broadcast-clicked": {
      if (state.broadcastList.status !== "listed") return state;
      const broadcast = state.broadcastList.broadcasts.find(
        (b) => b.id === action.broadcastId
      );
      return broadcast ? { ...state, pickedBroadcast: broadcast } : state;
    }
  }
};

export type BroadcastPickerRow = {
  broadcast: Broadcast;
  picked: boolean;
  /** Why Go Live will refuse it, or `null`. */
  refusal: string | null;
};

/** The picker's rows: every listed Broadcast, the picked one marked. */
export const broadcastPickerRows = (state: State): BroadcastPickerRow[] =>
  state.broadcastList.status === "listed"
    ? state.broadcastList.broadcasts.map((broadcast) => ({
        broadcast,
        picked: state.pickedBroadcast?.id === broadcast.id,
        refusal: broadcastRefusal(broadcast),
      }))
    : [];
