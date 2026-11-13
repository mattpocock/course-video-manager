import type { DocumentAgentMessage } from "./types";
import { toastError } from "@/components/ui/toast";
import {
  AIConversation,
  AIConversationContent,
  AIConversationScrollButton,
} from "components/ui/kibo-ui/ai/conversation";
import {
  AIInput,
  AIInputSubmit,
  AIInputTextarea,
  AIInputToolbar,
} from "components/ui/kibo-ui/ai/input";
import { AIMessage, AIMessageContent } from "components/ui/kibo-ui/ai/message";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Loader2Icon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { partsToText } from "./write-utils";
import type { WriteToolbarProps } from "./write-toolbar";
import { WriteToolbar } from "./write-toolbar";
import type { IndexedClip } from "./types";
import {
  CHOOSE_SCREENSHOT_COMPONENTS,
  ChooseScreenshotProvider,
  type ChooseScreenshotRuntime,
} from "./choose-screenshot-components";
import { preprocessChooseScreenshotMarkdown } from "./choose-screenshot-markdown";
import {
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
  removeChooseScreenshot,
  setChooseScreenshotFace,
  type ScreenshotFace,
} from "./choose-screenshot-mutations";
import { WriteDocumentDisplay, EditDocumentDisplay } from "./tool-call-display";
import { CacheStatsBadge } from "./cache-stats-badge";
import { AssistantMessage } from "./assistant-message";
import { useMessageTextMutation } from "./message-text-mutation";
import { RegenerateReply, RejectedToolCall, TurnFailure } from "./turn-failure";
import type { WriterFailure } from "./writer-errors";
import type { ClipFrame, ScreenCrop } from "@/packages/clip-source";

export interface WriteChatProps {
  messages: DocumentAgentMessage[];
  setMessages: (messages: DocumentAgentMessage[]) => void;
  /** The last turn's failure, shown after the last message with a Retry. */
  failure: WriterFailure | null;
  onRetry: () => void;
  onRegenerate: () => void;
  fullPath: string;
  onSubmit: (text: string) => void;
  onStop: () => void;
  status: "streaming" | "submitted" | "ready" | "error";
  indexedClips: IndexedClip[];
  videoId: string;
  className?: string;
  toolbarProps?: WriteToolbarProps;
  queuedMessages?: string[];
  documentRef?: React.RefObject<string | undefined>;
  updateDocument?: (content: string) => void;
  /** A message was edited in place (a screenshot's clip changed): save it. */
  onMessagesEdited?: (messages: DocumentAgentMessage[]) => void;
  /** Shown above the conversation: the Writer Chat loading, or failing. */
  notice?: React.ReactNode;
}

export const WriteChat = memo(function WriteChat(props: WriteChatProps) {
  const {
    messages,
    setMessages,
    failure,
    onRetry,
    onRegenerate,
    fullPath,
    onSubmit,
    onStop,
    status,
    indexedClips,
    videoId,
    className,
    toolbarProps,
    queuedMessages,
    documentRef,
    updateDocument,
    onMessagesEdited,
    notice,
  } = props;

  const [text, setText] = useState("");

  const mutateMessageText = useMessageTextMutation(messages, (updated) => {
    setMessages(updated);
    onMessagesEdited?.(updated);
  });

  const handleClipIndexChange = useCallback(
    (
      messageId: string,
      currentIndex: number,
      newIndex: number,
      alt: string
    ) => {
      mutateMessageText(messageId, (text) =>
        updateChooseScreenshotClipIndex(text, currentIndex, newIndex, alt)
      );
    },
    [mutateMessageText]
  );

  const handleRemove = useCallback(
    (messageId: string, clipIndex: number, alt: string) => {
      mutateMessageText(messageId, (text) =>
        removeChooseScreenshot(text, clipIndex, alt)
      );
    },
    [mutateMessageText]
  );

  const handleFaceChange = useCallback(
    (
      messageId: string,
      clipIndex: number,
      alt: string,
      face: ScreenshotFace,
      crop?: ScreenCrop
    ) => {
      mutateMessageText(messageId, (text) =>
        setChooseScreenshotFace(text, clipIndex, alt, face, crop)
      );
    },
    [mutateMessageText]
  );

  const [capturingKey, setCapturingKey] = useState<string | null>(null);

  const handleCapture = useCallback(
    async (
      messageId: string,
      clipIndex: number,
      alt: string,
      frame: ClipFrame
    ) => {
      const key = `${messageId}-${clipIndex}-${alt}`;
      setCapturingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(frame),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
        mutateMessageText(messageId, (text) =>
          replaceChooseScreenshotWithImage(text, clipIndex, alt, imagePath)
        );
        return true;
      } catch (err) {
        console.error("Screenshot capture failed:", err);
        toastError(err, "Screenshot capture failed");
        return false;
      } finally {
        setCapturingKey(null);
      }
    },
    [videoId, mutateMessageText]
  );

  const extraComponents =
    indexedClips.length === 0 ? undefined : CHOOSE_SCREENSHOT_COMPONENTS;

  const screenshotRuntime = useMemo(
    (): ChooseScreenshotRuntime => ({
      clips: indexedClips,
      isStreaming: status === "streaming" || status === "submitted",
      capturingKey,
      keyFor: (clipIndex, alt, messageId) => `${messageId}-${clipIndex}-${alt}`,
      onClipIndexChange: handleClipIndexChange,
      onCapture: handleCapture,
      onRemove: handleRemove,
      onFaceChange: handleFaceChange,
    }),
    [
      indexedClips,
      status,
      capturingKey,
      handleClipIndexChange,
      handleCapture,
      handleRemove,
      handleFaceChange,
    ]
  );

  const preprocessMarkdown = useMemo(() => {
    if (!extraComponents) return undefined;
    return (md: string, messageId?: string) => {
      let processed = preprocessChooseScreenshotMarkdown(md);
      // Inject message ID as data attribute so the component can identify which message to mutate
      if (messageId) {
        processed = processed.replace(
          /<choosescreenshot /g,
          `<choosescreenshot data-message-id="${messageId}" `
        );
      }
      return processed;
    };
  }, [extraComponents]);

  return (
    <ChooseScreenshotProvider runtime={screenshotRuntime}>
      <div
        className={
          className ? `${className} flex flex-col` : "w-3/4 flex flex-col"
        }
      >
        {notice}
        <AIConversation className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <AIConversationContent className="max-w-[75ch] mx-auto">
            {messages.map((message) => {
              if (message.role === "system") {
                return null;
              }

              if (message.role === "user") {
                return (
                  <AIMessage from={message.role} key={message.id}>
                    <AIMessageContent>
                      {partsToText(message.parts)}
                    </AIMessageContent>
                  </AIMessage>
                );
              }

              const textContent = partsToText(message.parts);

              return (
                <AssistantMessage key={message.id}>
                  {message.parts.map((part, partIndex) => {
                    if (
                      (part.type.startsWith("tool-") ||
                        part.type === "dynamic-tool") &&
                      "state" in part &&
                      part.state === "output-error"
                    ) {
                      return (
                        <RejectedToolCall
                          key={partIndex}
                          toolName={
                            "toolName" in part
                              ? String(part.toolName)
                              : part.type.slice("tool-".length)
                          }
                          errorText={
                            "errorText" in part ? part.errorText : undefined
                          }
                        />
                      );
                    }
                    if (part.type === "tool-writeDocument") {
                      return (
                        <WriteDocumentDisplay key={partIndex} part={part} />
                      );
                    }
                    if (part.type === "tool-editDocument") {
                      return (
                        <EditDocumentDisplay
                          key={partIndex}
                          part={part}
                          documentRef={documentRef}
                          updateDocument={updateDocument}
                        />
                      );
                    }
                    return null;
                  })}
                  {textContent && (
                    <AIResponse
                      imageBasePath={fullPath ?? ""}
                      extraComponents={extraComponents}
                      preprocessMarkdown={
                        preprocessMarkdown
                          ? (md: string) => preprocessMarkdown(md, message.id)
                          : undefined
                      }
                    >
                      {textContent}
                    </AIResponse>
                  )}
                  {message.metadata && (
                    <CacheStatsBadge stats={message.metadata} />
                  )}
                </AssistantMessage>
              );
            })}
            {failure ? (
              <TurnFailure failure={failure} onRetry={onRetry} />
            ) : (
              status === "ready" &&
              messages.at(-1)?.role === "assistant" && (
                <RegenerateReply onRegenerate={onRegenerate} />
              )
            )}
            {queuedMessages?.map((text, i) => (
              <AIMessage from="user" key={`queued-${i}`}>
                <AIMessageContent>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2Icon className="h-3 w-3 animate-spin shrink-0" />
                    {text}
                  </span>
                </AIMessageContent>
              </AIMessage>
            ))}
          </AIConversationContent>
          <AIConversationScrollButton />
        </AIConversation>
        <div className="border-t p-4 bg-background">
          <div className="max-w-[75ch] mx-auto">
            {toolbarProps && <WriteToolbar {...toolbarProps} />}
            <AIInput
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit(text.trim() || "Go");
                setText("");
              }}
            >
              <AIInputTextarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What would you like to create?"
              />
              <AIInputToolbar>
                <AIInputSubmit status={status} onStop={onStop} />
              </AIInputToolbar>
            </AIInput>
          </div>
        </div>
      </div>
    </ChooseScreenshotProvider>
  );
});
