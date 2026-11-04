import { useEffectReducer } from "@/hooks/use-effect-reducer";
import type { NewBroadcastAnswer } from "./broadcast";
import type { liveStreamReducer } from "./live-stream-reducer";
import {
  createInitialNewBroadcastState,
  newBroadcastReducer,
} from "./new-broadcast-reducer";
import type { NewBroadcastVideo } from "./new-stream-video";

/** Where New Broadcast creates (`routes/api.streaming.new-broadcast.ts`). */
export const NEW_BROADCAST_HREF = "/api/streaming/new-broadcast";

/** The reason a route refused with: its message, a JSON string or plain text. */
const reasonOf = (body: string) => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Plain text: the reason as it is.
  }
  return body;
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
      "create-broadcast": (_state, { settings }, dispatch) => {
        fetch(NEW_BROADCAST_HREF, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        })
          .then(async (response) => {
            if (!response.ok)
              throw new Error(
                reasonOf(await response.text()) || `HTTP ${response.status}`
              );
            const answer = (await response.json()) as NewBroadcastAnswer;
            dispatch({ type: "create-answered", answer });
          })
          .catch((e: unknown) =>
            dispatch({
              type: "create-failed",
              message: e instanceof Error ? e.message : String(e),
            })
          );
      },
      "pick-created-broadcast": (_state, { broadcast }) => {
        liveStreamDispatch({ type: "broadcast-created", broadcast });
      },
    }
  );
}
