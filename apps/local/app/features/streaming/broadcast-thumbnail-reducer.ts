import type { EffectReducer } from "use-effect-reducer";
import type { ThumbnailResult } from "./broadcast";
import type { ReportLine } from "./new-broadcast-reducer";
import { defaultThumbnailId, type NewBroadcastVideo } from "./new-stream-video";

/**
 * A picked **Broadcast**'s thumbnail, set or changed later, before or during
 * the Live Stream, from the Video's thumbnails
 * (`POST /api/streaming/broadcast-thumbnail`).
 */
export namespace broadcastThumbnailReducer {
  export type State = {
    /** The Video's thumbnails to pick from, and its default. */
    video: NewBroadcastVideo;
    open: boolean;
    thumbnailId: string | null;
    /** The set is out. */
    setting: boolean;
    /**
     * The last set, on which Broadcast, and how it went (null while out),
     * until the next press.
     */
    outcome: { broadcastId: string; result: ThumbnailResult | null } | null;
  };

  export type Action =
    | { type: "thumbnail-clicked" }
    | { type: "picker-dismissed" }
    | { type: "thumbnail-picked"; thumbnailId: string | null }
    | { type: "set-clicked"; broadcastId: string }
    | { type: "set-answered"; result: ThumbnailResult }
    | { type: "set-failed"; message: string };

  export type Effect = {
    type: "set-broadcast-thumbnail";
    broadcastId: string;
    thumbnailId: string;
  };
}

type State = broadcastThumbnailReducer.State;
type Action = broadcastThumbnailReducer.Action;
type Effect = broadcastThumbnailReducer.Effect;

export const createInitialBroadcastThumbnailState = (
  video: NewBroadcastVideo
): State => ({
  video,
  open: false,
  thumbnailId: defaultThumbnailId(video),
  setting: false,
  outcome: null,
});

/** Whether Set would send: a thumbnail picked, nothing out. */
export const canSetThumbnail = (state: State) =>
  !state.setting && state.thumbnailId !== null;

const answered = (state: State, result: ThumbnailResult): State =>
  !state.setting || state.outcome === null
    ? state
    : {
        ...state,
        setting: false,
        outcome: { ...state.outcome, result },
      };

export const broadcastThumbnailReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "thumbnail-clicked":
      return { ...state, open: true };
    case "picker-dismissed":
      return { ...state, open: false };
    case "thumbnail-picked":
      return { ...state, thumbnailId: action.thumbnailId };
    case "set-clicked":
      if (!canSetThumbnail(state)) return state;
      exec({
        type: "set-broadcast-thumbnail",
        broadcastId: action.broadcastId,
        thumbnailId: state.thumbnailId!,
      });
      return {
        ...state,
        setting: true,
        outcome: { broadcastId: action.broadcastId, result: null },
      };
    case "set-answered":
      return answered(state, action.result);
    case "set-failed":
      return answered(state, { status: "failed", reason: action.message });
  }
};

/**
 * What the picked Broadcast's thumbnail control says: set, or why not.
 * Null while a set is out, before any, or for another Broadcast.
 */
export const broadcastThumbnailReport = (
  state: State,
  pickedBroadcastId: string
): ReportLine | null => {
  const { outcome } = state;
  if (
    outcome === null ||
    outcome.result === null ||
    outcome.broadcastId !== pickedBroadcastId
  ) {
    return null;
  }
  switch (outcome.result.status) {
    case "none":
      return null;
    case "set":
      return { ok: true, words: "Thumbnail set." };
    case "failed":
      return {
        ok: false,
        words: `The thumbnail could not be set (${outcome.result.reason}): try again, or set it in YouTube Studio.`,
      };
  }
};
