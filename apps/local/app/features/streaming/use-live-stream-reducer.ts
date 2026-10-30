import { toastError } from "@/components/ui/toast";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type { BroadcastListAnswer } from "./broadcast";
import {
  createInitialLiveStreamState,
  liveStreamReducer,
} from "./live-stream-reducer";

/** Where the Broadcast picker lists from (`routes/api.streaming.broadcasts.ts`). */
export const BROADCASTS_HREF = "/api/streaming/broadcasts";

/** A JSON POST's options. */
const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Rejects with the app server's reason when it refused. */
const answered = async (response: Response) => {
  if (!response.ok)
    throw new Error((await response.text()) || `HTTP ${response.status}`);
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    // `routes/api.streaming.broadcast-pick.ts`
    "pick-broadcast": (_state, { pick }) => {
      fetch("/api/streaming/broadcast-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pick),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) || `HTTP ${response.status}`
            );
          }
        })
        .catch((e: unknown) =>
          toastError(e, "Couldn't start the Broadcast's chat.")
        );
    },
    "go-live": (_state, effect, dispatch) => {
      fetch(
        `/api/videos/${effect.videoId}/recorder/go-live`,
        postJson({
          broadcastId: effect.broadcastId,
          silenceLength: effect.silenceLength,
        })
      )
        .then(answered)
        .then(() => dispatch({ type: "go-live-answered" }))
        .catch((e: unknown) =>
          dispatch({ type: "go-live-refused", message: messageOf(e) })
        );
    },
    "end-stream": (_state, effect, dispatch) => {
      fetch(`/api/videos/${effect.videoId}/recorder/end-stream`, postJson({}))
        .then(answered)
        .then(() => dispatch({ type: "end-stream-answered" }))
        .catch((e: unknown) =>
          dispatch({ type: "end-stream-failed", message: messageOf(e) })
        );
    },
  });
}
