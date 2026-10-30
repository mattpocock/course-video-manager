import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type { BroadcastListAnswer } from "./broadcast";
import {
  createInitialLiveStreamState,
  liveStreamReducer,
} from "./live-stream-reducer";

/** Where the Broadcast picker lists from (`routes/api.streaming.broadcasts.ts`). */
export const BROADCASTS_HREF = "/api/streaming/broadcasts";

/** The Live Stream surface's effect runner: it only does the I/O asked for. */
export function useLiveStreamReducer() {
  return useEffectReducer(liveStreamReducer, createInitialLiveStreamState, {
    "list-broadcasts": (_state, _effect, dispatch) => {
      fetch(BROADCASTS_HREF)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) || `HTTP ${response.status}`
            );
          }
          const answer = (await response.json()) as BroadcastListAnswer;
          dispatch({ type: "broadcasts-answered", answer });
        })
        .catch((e: unknown) =>
          dispatch({
            type: "broadcast-listing-failed",
            message: e instanceof Error ? e.message : String(e),
          })
        );
    },
  });
}
