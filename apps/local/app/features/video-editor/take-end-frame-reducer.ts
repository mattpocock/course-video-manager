/**
 * Which take-end frame each Clip's last-frame overlay shows while its
 * Recording Session still records (`lastFrameSource` is `take-end`): the
 * live preview's own picture, kept the moment the take's speech ended. Its
 * saved still cannot be decoded yet (#2560), but the browser has this
 * picture already, so keeping it costs the capture nothing.
 *
 * A take's Clip is placed after its speech ends, so the next Clip the
 * overlay is for takes the picture kept last. Each Clip keeps its own until
 * the Stop (a new still round), when its still can be decoded.
 */
export namespace takeEndFrameReducer {
  export type State = {
    /** The picture from the last speech end, not yet a Clip's. */
    pending: string | null;
    /** Clip id → its take-end picture. */
    frames: Readonly<Record<string, string>>;
  };

  export type Action =
    | { type: "speech-ended"; picture: string | null }
    | { type: "overlay-clip-shown"; clipId: string; takeEnd: boolean }
    | { type: "still-round-changed" };
}

export const createInitialTakeEndFrameState =
  (): takeEndFrameReducer.State => ({ pending: null, frames: {} });

export const takeEndFrameReducer = (
  state: takeEndFrameReducer.State,
  action: takeEndFrameReducer.Action
): takeEndFrameReducer.State => {
  switch (action.type) {
    case "speech-ended":
      return { ...state, pending: action.picture };
    case "overlay-clip-shown": {
      const { clipId, takeEnd } = action;
      if (!takeEnd || !state.pending || state.frames[clipId]) return state;
      return {
        pending: null,
        frames: { ...state.frames, [clipId]: state.pending },
      };
    }
    case "still-round-changed":
      return createInitialTakeEndFrameState();
  }
};
