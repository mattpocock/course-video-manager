/**
 * The pop-out live chat (#2558): the Streaming tab's chat in a window of its
 * own, for a second monitor. A top-level flat route (no `_app.` prefix), so it
 * renders bare, like the teleprompter.
 *
 * It is a view of the Streaming tab, over BroadcastChannel
 * (`lib/stream-chat-protocol.ts`): the tab hears the chat and holds the Chat
 * Highlight, and sends the chat here; a click here goes back to the tab,
 * which decides (`stream-chat-bridge.ts`): it shows that message on the
 * stream, or hides it if it is the one showing. So it opens no connection to
 * the app server, and with no Streaming tab open it shows the last chat it
 * was sent and says so. It is drawn as a presenter view, for reading at a
 * distance (`stream-chat-presenter.tsx`, #2590).
 */
import { useEffect, useReducer } from "react";
import { streamChatChannel } from "@/lib/stream-chat-protocol";
import { StreamChatPresenter } from "@/features/streaming/stream-chat-presenter";
import {
  createInitialStreamChatPopoutState,
  streamChatPopoutReducer,
} from "@/features/streaming/stream-chat-popout-reducer";
import { NO_TOASTS } from "@/lib/route-toasts";
import type { Route } from "./+types/stream-chat";

const PING_INTERVAL_MS = 2000;

export const handle = NO_TOASTS;

export const meta: Route.MetaFunction = () => [{ title: "CVM - Live chat" }];

export default function StreamChat() {
  const [state, dispatch] = useReducer(
    streamChatPopoutReducer,
    undefined,
    createInitialStreamChatPopoutState
  );

  // Bridges the Streaming tab: its chat in, and a ping out every 2 s, which
  // says this window is open and asks for the chat.
  useEffect(() => {
    const unsubscribe = streamChatChannel.subscribeChild((message) =>
      dispatch({ type: "chat-view-heard", view: message.view, at: Date.now() })
    );
    const ping = () => {
      streamChatChannel.sendToParent({ type: "ping" });
      dispatch({ type: "ticked", at: Date.now() });
    };
    ping();
    const beat = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      clearInterval(beat);
      unsubscribe();
    };
  }, []);

  return (
    <StreamChatPresenter
      view={state.view}
      attached={state.attached}
      onMessageClicked={(messageId) =>
        streamChatChannel.sendToParent({
          type: "chat-message-clicked",
          messageId,
        })
      }
    />
  );
}
