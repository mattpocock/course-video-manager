import { toastError } from "@/components/ui/toast";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { readStored, writeStored } from "@/hooks/use-local-storage";
import type { BroadcastListAnswer } from "./broadcast";
import {
  createInitialLiveStreamState,
  liveStreamReducer,
  RECONNECT_GRACE_MS,
} from "./live-stream-reducer";
import { messageOf, reasonOf, unlistOfEndStreamAnswer } from "./route-answer";
import { unlistPreferenceKey } from "./unlist-when-ended";

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
    throw new Error(
      reasonOf(await response.text()) || `HTTP ${response.status}`
    );
};

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
    // `routes/api.videos.$videoId.recorder.show-highlight.ts`
    "show-highlight": (_state, { videoId, messageId }, dispatch) => {
      fetch(
        `/api/videos/${videoId}/recorder/show-highlight`,
        postJson({ messageId })
      )
        .then(async (response) => {
          await answered(response);
          const { highlightId } = (await response.json()) as {
            highlightId: string;
          };
          dispatch({ type: "chat-highlight-shown", messageId, highlightId });
        })
        .catch((e: unknown) =>
          dispatch({ type: "chat-highlight-failed", message: messageOf(e) })
        );
    },
    "hide-highlight": (_state, { videoId, highlightId }, dispatch) => {
      fetch(
        `/api/videos/${videoId}/recorder/hide-highlight`,
        postJson({ highlightId })
      )
        .then(answered)
        .then(() => dispatch({ type: "chat-highlight-hidden", highlightId }))
        .catch((e: unknown) =>
          dispatch({ type: "chat-highlight-failed", message: messageOf(e) })
        );
    },
    "await-reconnect-grace": (_state, { broadcastId, reconnect }, dispatch) => {
      const timer = setTimeout(
        () =>
          dispatch({
            type: "chat-reconnect-grace-ended",
            broadcastId,
            reconnect,
          }),
        RECONNECT_GRACE_MS
      );
      return () => clearTimeout(timer);
    },
    "end-stream": (_state, effect, dispatch) => {
      fetch(
        `/api/videos/${effect.videoId}/recorder/end-stream`,
        postJson({ unlistWhenEnded: effect.unlistWhenEnded })
      )
        .then(async (response) => {
          await answered(response);
          const unlist = unlistOfEndStreamAnswer(await response.json());
          dispatch({ type: "end-stream-answered", unlist });
        })
        .catch((e: unknown) =>
          dispatch({ type: "end-stream-failed", message: messageOf(e) })
        );
    },
    "read-unlist-preference": (_state, { videoId }, dispatch) => {
      const stored = readStored(unlistPreferenceKey(videoId));
      dispatch({
        type: "unlist-preference-read",
        videoId,
        checked: stored === null ? null : stored === "true",
      });
    },
    "save-unlist-preference": (_state, { videoId, checked }) => {
      writeStored(unlistPreferenceKey(videoId), String(checked));
    },
  });
}
