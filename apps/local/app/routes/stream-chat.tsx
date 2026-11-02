/**
 * The pop-out live chat (#2558): the Streaming tab's chat in a window of its
 * own, for a second monitor. A top-level flat route (no `_app.` prefix), so it
 * renders bare, like the teleprompter.
 *
 * It is a view of the Streaming tab, over BroadcastChannel
 * (`lib/stream-chat-protocol.ts`): the tab hears the chat and holds the Chat
 * Highlight, and sends the chat here; a click here goes back to the tab,
 * which decides. So it opens no connection to the app server, and with no
 * Streaming tab open it shows the last chat it was sent and says so.
 */
import { useEffect, useReducer } from "react";
import { MessageSquareIcon } from "lucide-react";
import { streamChatChannel } from "@/lib/stream-chat-protocol";
import { ChatList } from "@/features/streaming/broadcast-chat-view";
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
    <div
      className="flex flex-col h-screen p-3 gap-2"
      data-testid="stream-chat-popout"
    >
      <div className="flex items-center gap-2 shrink-0">
        <MessageSquareIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Live chat</h1>
      </div>
      {!state.attached && (
        <p className="text-xs shrink-0 text-amber-600">
          Open the Streaming tab: this window shows its chat.
        </p>
      )}
      {state.view && (
        <ChatList
          view={state.view}
          onMessageClicked={(messageId) =>
            streamChatChannel.sendToParent({
              type: "chat-message-clicked",
              messageId,
            })
          }
        />
      )}
    </div>
  );
}
