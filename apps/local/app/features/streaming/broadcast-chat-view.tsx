import { useEffect, useRef } from "react";
import { MessageSquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLiveStream } from "./live-stream-context";
import {
  BROADCAST_CHAT_EVENT_TYPES,
  type BroadcastChatEvent,
  type ChatConnection,
  type ChatOverReason,
} from "./broadcast-chat";

/** Where the app server relays the chat (`routes/api.streaming.chat.events.ts`). */
const CHAT_EVENTS_HREF = "/api/streaming/chat/events";

const OVER_MESSAGES: Record<ChatOverReason, string> = {
  "no-chat": "This Broadcast has no live chat.",
  ended: "This Broadcast's chat has ended.",
  "not-found": "YouTube can't find this Broadcast's chat.",
  disabled: "Chat is turned off for this Broadcast.",
};

/** A line about the chat connection, or `null` while it simply streams. */
const connectionLine = (
  connection: ChatConnection
): { text: string; warn: boolean } | null => {
  switch (connection.state) {
    case "idle":
      return { text: "Pick a Broadcast to see its live chat.", warn: false };
    case "connecting":
      return { text: "Connecting to chat…", warn: false };
    case "streaming":
      return null;
    case "polling":
      return {
        text: "YouTube refused the streaming chat connection, so chat is polled.",
        warn: true,
      };
    case "reconnecting":
      return {
        text: `Chat connection dropped, reconnecting: ${connection.message}`,
        warn: true,
      };
    case "over":
      return { text: OVER_MESSAGES[connection.reason], warn: false };
    case "needs-reconnect":
      return {
        text: "Reconnect Google above to read this Broadcast's chat.",
        warn: true,
      };
  }
};

/**
 * The picked Broadcast's live chat on the Streaming tab, as it's posted. The
 * app server reads it whether or not this shows; on mount this listens and
 * hears everything the app server kept first.
 */
export const BroadcastChatView = () => {
  const { state, dispatch } = useLiveStream();
  const bottom = useRef<HTMLLIElement>(null);

  // Bridges the app server's chat into the Live Stream surface.
  useEffect(() => {
    const source = new EventSource(CHAT_EVENTS_HREF);
    for (const type of BROADCAST_CHAT_EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        dispatch(JSON.parse(event.data) as BroadcastChatEvent);
      });
    }
    return () => source.close();
  }, [dispatch]);

  const { messages, connection } = state.chat;

  // Keeps the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const line = connectionLine(connection);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-2"
      data-testid="stream-chat"
    >
      <div className="flex items-center gap-2 shrink-0">
        <MessageSquareIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Live chat</h2>
      </div>
      {line && (
        <p
          className={cn(
            "text-xs shrink-0",
            line.warn ? "text-amber-600" : "text-muted-foreground"
          )}
        >
          {line.text}
        </p>
      )}
      {messages.length === 0 && connection.state === "streaming" && (
        <p className="text-xs text-muted-foreground">No messages yet.</p>
      )}
      <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 text-sm">
        {messages.map((message) => (
          <li key={message.id} className="break-words">
            <span className="font-medium text-muted-foreground mr-1.5">
              {message.author}
            </span>
            <span>{message.text}</span>
          </li>
        ))}
        <li ref={bottom} aria-hidden />
      </ul>
    </div>
  );
};
