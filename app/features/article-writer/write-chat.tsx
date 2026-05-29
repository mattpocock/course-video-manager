import { Card } from "@/components/ui/card";
import type { DocumentAgentMessage } from "./types";
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
import type { Options } from "react-markdown";
import type { HTMLAttributes } from "react";
import { Loader2Icon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { partsToText, saveMessagesToStorage } from "./write-utils";
import type { WriteToolbarProps } from "./write-toolbar";
import { WriteToolbar } from "./write-toolbar";
import type { IndexedClip, Mode } from "./types";
import { ChooseScreenshot } from "./choose-screenshot";
import { preprocessChooseScreenshotMarkdown } from "./choose-screenshot-markdown";
import {
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
  removeChooseScreenshot,
} from "./choose-screenshot-mutations";
import { WriteDocumentDisplay, EditDocumentDisplay } from "./tool-call-display";

export interface WriteChatProps {
  messages: DocumentAgentMessage[];
  setMessages: (messages: DocumentAgentMessage[]) => void;
  error: Error | undefined;
  fullPath: string;
  onSubmit: (text: string) => void;
  status: "streaming" | "submitted" | "ready" | "error";
  indexedClips: IndexedClip[];
  mode: Mode;
  videoId: string;
  className?: string;
  toolbarProps: WriteToolbarProps;
  queuedMessages?: string[];
  documentRef?: React.RefObject<string | undefined>;
  updateDocument?: (content: string) => void;
}

export const WriteChat = memo(function WriteChat(props: WriteChatProps) {
  const {
    messages,
    setMessages,
    error,
    fullPath,
    onSubmit,
    status,
    indexedClips,
    mode,
    videoId,
    className,
    toolbarProps,
    queuedMessages,
    documentRef,
    updateDocument,
  } = props;

  const [text, setText] = useState("");

  const mutateMessageText = useCallback(
    (messageId: string, mutator: (text: string) => string) => {
      const updated = messages.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          parts: msg.parts.map((part) => {
            if (part.type !== "text") return part;
            return { ...part, text: mutator(part.text) };
          }),
        };
      });
      setMessages(updated);
      saveMessagesToStorage(videoId, mode, updated);
    },
    [messages, setMessages, videoId, mode]
  );

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

  const [capturingKey, setCapturingKey] = useState<string | null>(null);

  const handleCapture = useCallback(
    async (
      messageId: string,
      clipIndex: number,
      alt: string,
      timestamp: number,
      videoFilename: string
    ) => {
      const key = `${messageId}-${clipIndex}-${alt}`;
      setCapturingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timestamp, videoFilename }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
        mutateMessageText(messageId, (text) =>
          replaceChooseScreenshotWithImage(text, clipIndex, alt, imagePath)
        );
      } catch (err) {
        console.error("Screenshot capture failed:", err);
      } finally {
        setCapturingKey(null);
      }
    },
    [videoId, mutateMessageText]
  );

  const extraComponents = useMemo((): Options["components"] | undefined => {
    if (indexedClips.length === 0) return undefined;
    return {
      choosescreenshot: ((
        compProps: HTMLAttributes<HTMLElement> & Record<string, unknown>
      ) => {
        const clipIdx = parseInt(compProps.clipindex as string, 10);
        const altText = (compProps.alt as string) ?? "";
        const msgId = (compProps["data-message-id"] as string) ?? "";
        const key = `${msgId}-${clipIdx}-${altText}`;
        return (
          <ChooseScreenshot
            clipIndex={clipIdx}
            alt={altText}
            clips={indexedClips}
            onClipIndexChange={(current, next) =>
              handleClipIndexChange(msgId, current, next, altText)
            }
            onCapture={(ci, a, timestamp, videoFilename) =>
              handleCapture(msgId, ci, a, timestamp, videoFilename)
            }
            onRemove={(ci, a) => handleRemove(msgId, ci, a)}
            isCapturing={capturingKey === key}
            isStreaming={status === "streaming" || status === "submitted"}
          />
        );
      }) as unknown,
    } as Options["components"];
  }, [
    indexedClips,
    mode,
    handleClipIndexChange,
    handleCapture,
    handleRemove,
    capturingKey,
    status,
  ]);

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
    <div
      className={
        className ? `${className} flex flex-col` : "w-3/4 flex flex-col"
      }
    >
      <AIConversation className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
        <AIConversationContent className="max-w-[75ch] mx-auto">
          {error && (
            <Card className="p-4 mb-4 border-red-500 bg-red-50 dark:bg-red-950">
              <div className="flex items-start gap-2">
                <div className="text-red-500 font-semibold">Error:</div>
                <div className="text-red-700 dark:text-red-300 flex-1">
                  {error.message}
                </div>
              </div>
            </Card>
          )}
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
              <AIMessage from={message.role} key={message.id}>
                {message.parts.map((part, partIndex) => {
                  if (part.type === "tool-writeDocument") {
                    return <WriteDocumentDisplay key={partIndex} part={part} />;
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
              </AIMessage>
            );
          })}
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
          <WriteToolbar {...toolbarProps} />
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
              <AIInputSubmit status={status} />
            </AIInputToolbar>
          </AIInput>
        </div>
      </div>
    </div>
  );
});
