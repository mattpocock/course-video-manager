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
import React, { useState, type FormEvent } from "react";
import type { Route } from "./+types/videos.$videoId.write";
import { ChevronLeftIcon } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  AISuggestion,
  AISuggestions,
} from "components/ui/kibo-ui/ai/suggestion";

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
      lessonNumber: video.lesson.path.split("-")[0]!,
    };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

const PROBLEM_PROMPT = (lessonNumber: string) =>
  `
Go.

## Problem Code

Show COPIOUS examples of the problem code. Show the TODO's in the code so the user can navigate to the correct location.

## Solution Code

Do NOT refer to the solution code in the steps. Do not reveal the exact solution - just describe the problem they need to solve. Do not attempt to solve the problem for the user.

The purpose of this material is to help the user solve the problem.

## Steps To Complete Instructions

At the end of the output, add a list of steps to complete to solve the problem.

Include steps to test whether the problem has been solved, such as logging in the terminal (running the exercise via \`pnpm run exercise ${lessonNumber}\`), observing the local dev server at localhost:3000, or checking the browser console.

This should be in the format of checkboxes. Only the top level steps should be checkboxes. You can can use nested lists, but they should not be checkboxes.

Each top-level step should be separated by two newlines.

<example>

## Steps To Complete

- [ ] <A description of the step to take>
  - <some substep>

- [ ] <A description of the step to take>

- [ ] <A description of the step to take>
  - <some substep>
  - <some substep>

</example>
`.trim();

const Video = (props: { src: string }) => {
  return <video src={props.src} className="w-full" controls />;
};

const LazyVideo = React.lazy(() => Promise.resolve({ default: Video }));

export default function Component(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const { videoPath, lessonPath, sectionPath, repoId, lessonId, lessonNumber } =
    props.loaderData;
  const [text, setText] = useState<string>("");

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
          <LazyVideo src={`/videos/${videoId}`} />
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
      <div>
        <AISuggestions className="mb-4">
          <AISuggestion
            suggestion="Problem Description"
            onClick={() => {
              sendMessage({
                text: PROBLEM_PROMPT(lessonNumber),
              });
            }}
          ></AISuggestion>
        </AISuggestions>
        <AIInput onSubmit={handleSubmit}>
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
  );
}
