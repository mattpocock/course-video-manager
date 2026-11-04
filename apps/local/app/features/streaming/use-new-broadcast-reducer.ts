import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type { NewBroadcastAnswer, ThumbnailResult } from "./broadcast";
import {
  broadcastThumbnailReducer,
  createInitialBroadcastThumbnailState,
} from "./broadcast-thumbnail-reducer";
import type { liveStreamReducer } from "./live-stream-reducer";
import {
  createInitialNewBroadcastState,
  newBroadcastReducer,
} from "./new-broadcast-reducer";
import type { NewBroadcastVideo } from "./new-stream-video";
import { messageOf, reasonOf } from "./route-answer";

/** Where New Broadcast creates (`routes/api.streaming.new-broadcast.ts`). */
export const NEW_BROADCAST_HREF = "/api/streaming/new-broadcast";

/** Where a picked Broadcast's thumbnail is set (`routes/api.streaming.broadcast-thumbnail.ts`). */
export const BROADCAST_THUMBNAIL_HREF = "/api/streaming/broadcast-thumbnail";

/** POSTs JSON to one of the app server's streaming routes; its answer, or why not. */
const postJson = async <T>(href: string, body: unknown): Promise<T> => {
  const response = await fetch(href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      reasonOf(await response.text()) || `HTTP ${response.status}`
    );
  return (await response.json()) as T;
};

/**
 * The New Broadcast form's effect runner: it creates, and hands a created
 * Broadcast to the Live Stream surface (`liveStreamDispatch`).
 */
export function useNewBroadcastReducer(
  video: NewBroadcastVideo,
  liveStreamDispatch: (action: liveStreamReducer.Action) => void
) {
  return useEffectReducer(
    newBroadcastReducer,
    () => createInitialNewBroadcastState(video),
    {
      "create-broadcast": (_state, { videoId, settings }, dispatch) => {
        postJson<NewBroadcastAnswer>(NEW_BROADCAST_HREF, {
          ...settings,
          videoId,
        })
          .then((answer) => dispatch({ type: "create-answered", answer }))
          .catch((e: unknown) =>
            dispatch({ type: "create-failed", message: messageOf(e) })
          );
      },
      "pick-created-broadcast": (_state, { broadcast }) => {
        liveStreamDispatch({ type: "broadcast-created", broadcast });
      },
    }
  );
}

/**
 * The picked Broadcast's thumbnail control's effect runner: it sets one of
 * the Video's thumbnails on the Broadcast.
 */
export function useBroadcastThumbnailReducer(video: NewBroadcastVideo) {
  return useEffectReducer(
    broadcastThumbnailReducer,
    () => createInitialBroadcastThumbnailState(video),
    {
      "set-broadcast-thumbnail": (
        _state,
        { videoId, broadcastId, thumbnailId },
        dispatch
      ) => {
        postJson<ThumbnailResult>(BROADCAST_THUMBNAIL_HREF, {
          broadcastId,
          thumbnailId,
          videoId,
        })
          .then((result) => dispatch({ type: "set-answered", result }))
          .catch((e: unknown) =>
            dispatch({ type: "set-failed", message: messageOf(e) })
          );
      },
    }
  );
}
