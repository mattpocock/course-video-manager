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

import { Button } from "@/components/ui/button";
import { AIMessage, AIMessageContent } from "components/ui/kibo-ui/ai/message";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Array as EffectArray, Effect } from "effect";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  SaveIcon,
  CheckIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/videos.$videoId.write";
import path from "path";
import { FileSystem } from "@effect/platform";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "./videos.$videoId.completions";
import { FileTree } from "@/components/FileTree";

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
    const fs = yield* FileSystem.FileSystem;
    const video = yield* db.getVideoById(videoId);

    const repo = video.lesson.section.repo;
    const section = video.lesson.section;
    const lesson = video.lesson;

    const lessonPath = path.join(repo.filePath, section.path, lesson.path);

    const allFilesInDirectory = yield* fs
      .readDirectory(lessonPath, {
        recursive: true,
      })
      .pipe(
        Effect.map((files) => files.map((file) => path.join(lessonPath, file)))
      );

    const filteredFiles = allFilesInDirectory.filter((filePath) => {
      return !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
        filePath.includes(excludedDir)
      );
    });

    const filesWithMetadata = yield* Effect.forEach(
      filteredFiles,
      (filePath) => {
        return Effect.gen(function* () {
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return null;
          }

          const relativePath = path.relative(lessonPath, filePath);
          const extension = path.extname(filePath).slice(1);

          const defaultEnabled =
            DEFAULT_CHECKED_EXTENSIONS.includes(extension) &&
            !DEFAULT_UNCHECKED_PATHS.some((uncheckedPath) =>
              relativePath.toLowerCase().includes(uncheckedPath.toLowerCase())
            );

          return {
            path: relativePath,
            size: Number(stat.size),
            defaultEnabled,
          };
        });
      }
    ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));

    const nextVideoId = yield* db.getNextVideoId(videoId);
    const previousVideoId = yield* db.getPreviousVideoId(videoId);

    return {
      videoPath: video.path,
      lessonPath: lesson.path,
      sectionPath: section.path,
      repoId: video.lesson.section.repoId,
      lessonId: video.lesson.id,
      fullPath: lessonPath,
      files: filesWithMetadata,
      nextVideoId,
      previousVideoId,
    };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 2;
    }
  }, [props.src, ref.current]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

type Mode = "article" | "project" | "skill-building";

const MODE_STORAGE_KEY = "article-writer-mode";

export function InnerComponent(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    videoPath,
    lessonPath,
    sectionPath,
    repoId,
    lessonId,
    fullPath,
    files,
    nextVideoId,
    previousVideoId,
  } = props.loaderData;
  const [text, setText] = useState<string>("");
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      return (saved as Mode) || "article";
    }
    return "article";
  });
  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(() => {
    return new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
  });

  // Check if explainer or problem folder exists
  const hasExplainerOrProblem = files.some(
    (f) => f.path.startsWith("explainer/") || f.path.startsWith("problem/")
  );

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, newMode);
    }
  };

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `/videos/${videoId}/completions`,
    }),
  });

  const writeToReadmeFetcher = useFetcher();
  const [isCopied, setIsCopied] = useState(false);

  // Get last assistant message
  const lastAssistantMessage = messages
    .slice()
    .reverse()
    .find((m) => m.role === "assistant");
  const lastAssistantMessageText = lastAssistantMessage
    ? partsToText(lastAssistantMessage.parts)
    : "";

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(lastAssistantMessageText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const writeToReadme = () => {
    writeToReadmeFetcher.submit(
      { lessonId, content: lastAssistantMessageText },
      {
        method: "POST",
        action: "/api/write-readme",
        encType: "application/json",
      }
    );
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    sendMessage(
      { text: text.trim() || "Go" },
      { body: { enabledFiles: Array.from(enabledFiles), mode } }
    );

    setText("");
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center gap-2 p-4 border-b justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/?repoId=${repoId}#${lessonId}`}>
              <ChevronLeftIcon className="size-6" />
            </Link>
          </Button>
          <h1 className="text-lg">
            {sectionPath}/{lessonPath}/{videoPath}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {previousVideoId ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/videos/${previousVideoId}/write`}>
                <ChevronLeftIcon className="size-4 mr-1" />
                Previous
              </Link>
            </Button>
          ) : null}
          {nextVideoId ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/videos/${nextVideoId}/write`}>
                Next
                <ChevronRightIcon className="size-4 ml-1" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {/* Left column: Video and Files */}
        <div className="w-1/4 border-r overflow-y-auto p-4 space-y-4 scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600">
          <Video src={`/videos/${videoId}`} />
          <FileTree
            files={files}
            enabledFiles={enabledFiles}
            onEnabledFilesChange={setEnabledFiles}
          />
        </div>

        {/* Right column: Chat */}
        <div className="w-3/4 flex flex-col">
          <AIConversation className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600">
            <AIConversationContent className="max-w-2xl mx-auto">
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
                    <AIResponse imageBasePath={fullPath}>
                      {partsToText(message.parts)}
                    </AIResponse>
                  </AIMessage>
                );
              })}
            </AIConversationContent>
            <AIConversationScrollButton />
          </AIConversation>
          <div className="border-t p-4 bg-background">
            <div className="max-w-2xl mx-auto">
              <div className="mb-4 flex gap-2 items-center">
                <Select
                  value={mode}
                  onValueChange={(value) => handleModeChange(value as Mode)}
                >
                  <SelectTrigger>
                    {mode === "article"
                      ? "Article"
                      : mode === "project"
                      ? "Project Steps"
                      : "Skill Building Steps"}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="article">
                      <div>
                        <div>Article</div>
                        <div className="text-xs text-muted-foreground">
                          Educational content and explanations
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="project">
                      <div>
                        <div>Steps - Project</div>
                        <div className="text-xs text-muted-foreground">
                          Write steps for project
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="skill-building">
                      <div>
                        <div>Steps - Skill Building</div>
                        <div className="text-xs text-muted-foreground">
                          Write steps for skill building problem
                        </div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyToClipboard}
                  disabled={status === "streaming"}
                >
                  {isCopied ? (
                    <>
                      <CheckIcon className="h-4 w-4 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={writeToReadme}
                          disabled={
                            !hasExplainerOrProblem ||
                            status === "streaming" ||
                            writeToReadmeFetcher.state === "submitting" ||
                            writeToReadmeFetcher.state === "loading"
                          }
                        >
                          <SaveIcon className="h-4 w-4 mr-1" />
                          {writeToReadmeFetcher.state === "submitting" ||
                          writeToReadmeFetcher.state === "loading"
                            ? "Writing..."
                            : "Readme"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!hasExplainerOrProblem && (
                      <TooltipContent>
                        <p>No explainer or problem folder</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
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
        </div>
      </div>
    </div>
  );
}

export default function Component(props: Route.ComponentProps) {
  return <InnerComponent {...props} key={props.params.videoId} />;
}
