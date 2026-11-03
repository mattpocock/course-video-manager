import { useEffect, useMemo, useRef } from "react";
import { useContextSelector } from "use-context-selector";
import { ExternalLinkIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { streamChatChannel } from "@/lib/stream-chat-protocol";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { usePopupOpen } from "@/features/video-editor/hooks/use-popup-open";
import { useLiveStream } from "./live-stream-context";
import { decodeStreamData } from "@/features/jobs/job-wire";
import {
  BROADCAST_CHAT_EVENT_TYPES,
  BroadcastChatEvent,
} from "./broadcast-chat";
import { chatView, popoutChatView, type ChatView } from "./chat-view";
import { streamChatBridgeStep } from "./stream-chat-bridge";

/** Where the app server relays the chat (`routes/api.streaming.chat.events.ts`). */
const CHAT_EVENTS_HREF = "/api/streaming/chat/events";

/**
 * Bridges the app server's chat into the Live Stream surface while the
 * Streaming tab is open, whether the chat shows here or in its pop-out. The
 * app server reads it whether or not this listens; on mount this hears
 * everything the app server kept first.
 */
export const useBroadcastChatBridge = () => {
  const { dispatch } = useLiveStream();
  useEffect(() => {
    const source = new EventSource(CHAT_EVENTS_HREF);
    for (const type of BROADCAST_CHAT_EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        // Anything that isn't a chat event is not dispatched.
        const heard = decodeStreamData(BroadcastChatEvent, event.data);
        if (heard?.type === type) dispatch(heard);
      });
    }
    return () => source.close();
  }, [dispatch]);
};

/**
 * The live chat as `chatView` describes it: the Streaming tab's panel and the
 * pop-out window both draw this. Clicking a message reports it.
 */
export const ChatList = (props: {
  view: ChatView;
  onMessageClicked: (messageId: string) => void;
}) => {
  const bottom = useRef<HTMLLIElement>(null);
  const { line, notices, waiting, rows } = props.view;

  // Keeps the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [rows.length]);

  return (
    <>
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
      {notices.map((notice) => (
        <p
          key={notice}
          className="text-xs shrink-0 text-amber-600"
          data-testid="chat-notice"
        >
          {notice}
        </p>
      ))}
      {waiting && (
        <p className="text-xs text-muted-foreground">No messages yet.</p>
      )}
      <ul className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 text-base">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              aria-pressed={row.highlighted}
              title={
                row.highlighted
                  ? "On the stream: click to hide it"
                  : "Click to show it on the stream"
              }
              onClick={() => props.onMessageClicked(row.id)}
              className={cn(
                "w-full text-left break-words rounded px-2 py-1.5 hover:bg-muted",
                row.highlighted && "bg-amber-500/15 ring-1 ring-amber-500",
                row.pending && "opacity-60"
              )}
            >
              <span className="font-medium text-muted-foreground mr-1.5">
                {row.author}
              </span>
              <span>{row.text}</span>
            </button>
          </li>
        ))}
        <li ref={bottom} aria-hidden />
      </ul>
    </>
  );
};

/**
 * The picked Broadcast's live chat on the Streaming tab, as it's posted.
 * While live, clicking a message shows it on the stream picture as a Chat
 * Highlight, and clicking it again hides it (`chat-highlight-reducer.ts`),
 * unless the card's browser is not downloaded, which it says (Go Live is
 * unaffected). Pop out moves it to its own window (#2558), which this tab
 * keeps fed (`lib/stream-chat-protocol.ts`) and takes its clicks from.
 */
export const BroadcastChatView = (props: {
  /** Why Chat Highlights can't be shown this Go Live, if they can't. */
  highlightsUnavailable: string | null;
}) => {
  const { state, dispatch } = useLiveStream();
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const poppedOut = usePopupOpen(streamChatChannel);

  const view = useMemo(
    () => chatView(state, props.highlightsUnavailable),
    [state, props.highlightsUnavailable]
  );
  // The pop-out is shown to the audience: it hears no connection trouble.
  const popoutView = useMemo(
    () => popoutChatView(state, props.highlightsUnavailable),
    [state, props.highlightsUnavailable]
  );
  const latestView = useRef(popoutView);
  latestView.current = popoutView;

  // Bridges the pop-out window: its clicks in, the chat out.
  useEffect(
    () =>
      streamChatChannel.subscribeParent((message) => {
        const step = streamChatBridgeStep(message, videoId);
        if (step.type === "send-chat-view") {
          streamChatChannel.sendToChild({
            type: "chat-view",
            view: latestView.current,
          });
        } else {
          dispatch(step.action);
        }
      }),
    [dispatch, videoId]
  );
  useEffect(() => {
    streamChatChannel.sendToChild({ type: "chat-view", view: popoutView });
  }, [popoutView]);

  const onMessageClicked = (messageId: string) =>
    dispatch({ type: "chat-message-clicked", videoId, messageId });

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-2"
      data-testid="stream-chat"
    >
      <div className="flex items-center gap-2 shrink-0">
        <MessageSquareIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Live chat</h2>
      </div>
      {poppedOut ? (
        <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>The chat is popped out into its own window.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => streamChatChannel.open()}
          >
            <ExternalLinkIcon className="size-4 mr-1" />
            Show it
          </Button>
        </div>
      ) : (
        <ChatList view={view} onMessageClicked={onMessageClicked} />
      )}
    </div>
  );
};
