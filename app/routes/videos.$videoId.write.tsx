"use client";

import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
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
import { Effect } from "effect";
import { useState, type FormEvent } from "react";
import type { Route } from "./+types/videos.$videoId.write";
import { ChevronLeftIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const partsToText = (parts: UIMessage["parts"]) => {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      return "";
    })
    .join("");
};

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBService;
    const video = yield* db.getVideoById(videoId);
    return {
      videoPath: video.path,
      lessonPath: video.lesson.path,
      sectionPath: video.lesson.section.path,
      repoId: video.lesson.section.repoId,
      lessonId: video.lesson.id,
    };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

export default function Component(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const { videoPath, lessonPath, sectionPath, repoId, lessonId } =
    props.loaderData;
  const [text, setText] = useState<string>("Go.");

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/videos/${videoId}/completions`,
    }),
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    sendMessage({
      text,
    });

    setText("");
  };

  return (
    <div className="max-w-4xl mx-auto p-6 h-screen flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/?repoId=${repoId}#${lessonId}`}>
            <ChevronLeftIcon className="size-6" />
          </Link>
        </Button>
        <h1 className="text-lg">
          {sectionPath}/{lessonPath}/{videoPath}
        </h1>
      </div>
      <AIConversation className="flex-1 overflow-y-auto">
        <AIConversationContent>
          <video src={`/videos/${videoId}`} className="w-full" controls />
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

            return (
              <AIMessage from={message.role} key={message.id}>
                <AIResponse>{partsToText(message.parts)}</AIResponse>
              </AIMessage>
            );
          })}
        </AIConversationContent>
        <AIConversationScrollButton />
      </AIConversation>
      <AIInput onSubmit={handleSubmit}>
        <AIInputTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <AIInputToolbar>
          <AIInputSubmit status={status} />
        </AIInputToolbar>
      </AIInput>
    </div>
  );
}
