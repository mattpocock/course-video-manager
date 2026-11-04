import type { liveStreamReducer } from "./live-stream-reducer";

type State = liveStreamReducer.State;
type Effect = liveStreamReducer.Effect;

/**
 * UNLIST WHEN ENDED on the Live Stream surface (#2681): whether End Stream
 * makes a public Broadcast Unlisted once it has completed it. The choice is
 * kept per CVM Video in localStorage, and is on until Matt turns it off. The
 * runner only reads and writes it; this decides.
 */

/** The localStorage key a Video's choice is kept under. */
export const unlistPreferenceKey = (videoId: string) =>
  `streaming:unlistWhenEnded:${videoId}`;

export type UnlistWhenEndedAction =
  /** The Streaming tab for this Video mounted. */
  | { type: "streaming-tab-shown"; videoId: string }
  /** The Video's stored choice, or null when none is stored. */
  | { type: "unlist-preference-read"; videoId: string; checked: boolean | null }
  | { type: "unlist-when-ended-toggled"; videoId: string; checked: boolean };

export type UnlistWhenEndedEffect =
  | { type: "read-unlist-preference"; videoId: string }
  | { type: "save-unlist-preference"; videoId: string; checked: boolean };

/** The Video's choice: on unless Matt turned it off. */
export const unlistWhenEndedOf = (state: State, videoId: string): boolean =>
  state.unlistWhenEnded[videoId] ?? true;

/** End Stream unlists only a public picked Broadcast, with the choice on. */
export const unlistAtEndStream = (state: State, videoId: string): boolean =>
  state.pickedBroadcast?.privacyStatus === "public" &&
  unlistWhenEndedOf(state, videoId);

/** The checkbox beside the picked Broadcast: only when it is public. */
export const unlistWhenEndedBesidePick = (
  state: State,
  videoId: string
): { checked: boolean } | null =>
  state.pickedBroadcast?.privacyStatus === "public"
    ? { checked: unlistWhenEndedOf(state, videoId) }
    : null;

/** What the Streaming tab says when End Stream couldn't unlist. */
export const unlistFailedWords = (message: string) =>
  `The Broadcast ended, but CVM couldn't make it Unlisted: ${message}. Make it Unlisted in YouTube Studio.`;

export const unlistWhenEndedReducer = (
  state: State,
  action: UnlistWhenEndedAction,
  exec: (effect: Effect) => void
): State => {
  switch (action.type) {
    case "streaming-tab-shown":
      exec({ type: "read-unlist-preference", videoId: action.videoId });
      return state;
    case "unlist-preference-read":
      // A toggle made while the read was out is the newer word.
      if (action.checked === null || action.videoId in state.unlistWhenEnded)
        return state;
      return {
        ...state,
        unlistWhenEnded: {
          ...state.unlistWhenEnded,
          [action.videoId]: action.checked,
        },
      };
    case "unlist-when-ended-toggled":
      exec({
        type: "save-unlist-preference",
        videoId: action.videoId,
        checked: action.checked,
      });
      return {
        ...state,
        unlistWhenEnded: {
          ...state.unlistWhenEnded,
          [action.videoId]: action.checked,
        },
      };
  }
};
