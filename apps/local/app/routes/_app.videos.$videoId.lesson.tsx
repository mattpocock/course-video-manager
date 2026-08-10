"use client";

export const handle = { fullscreen: true };

import {
  loadVideoPostingContext,
  loadWriterContext,
} from "@/services/video-posting-context.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader, makeAction } from "@/services/route-action.server";
import { Effect } from "effect";
import { useState } from "react";
import { redirect, useRevalidator } from "react-router";
import type { WriterContextData } from "@/services/video-posting-context.server";
import { VideoFilePasteModal } from "@/components/video-file-paste-modal";
import type { Route } from "./+types/_app.videos.$videoId.lesson";
import { LessonPage } from "@/features/video-posting/lesson-page";
import { useWriterContext } from "@/features/article-writer/use-writer-context";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);
      if (!video.lesson) {
        return yield* Effect.die(redirect(`/videos/${videoId}/edit`));
      }
      const ctx = yield* loadVideoPostingContext(videoId);
      const writerContextPromise: Promise<WriterContextData> =
        runtimeLive.runPromise(loadWriterContext(videoId));
      return {
        ...ctx,
        videoBody: video.body,
        videoDescription: video.description,
        writerContextPromise,
      };
    }),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const data = payload as Record<string, string>;

      if (data.intent === "updateBody") {
        yield* videoOps.updateVideoBody({
          videoId,
          body: data.body || null,
        });
        return { ok: true };
      }

      if (data.intent === "updateDescription") {
        yield* videoOps.updateVideoDescription({
          videoId,
          description: data.description || null,
        });
        return { ok: true };
      }

      return { ok: false };
    }),
});

export default function LessonPostPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const { files, videoBody, videoDescription, writerContextPromise } =
    props.loaderData;

  const writerContext = useWriterContext(writerContextPromise);
  const revalidator = useRevalidator();

  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <div className="flex-1 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <LessonPage
            videoId={videoId}
            body={videoBody}
            description={videoDescription}
            writerContext={writerContext}
            onAddFileFromClipboard={() => setIsPasteModalOpen(true)}
          />
        </div>
      </div>

      <VideoFilePasteModal
        videoId={videoId}
        open={isPasteModalOpen}
        onOpenChange={setIsPasteModalOpen}
        existingFiles={files}
        onFileCreated={() => {
          // Refresh the writer context so the new file shows in Repo Files.
          revalidator.revalidate();
        }}
      />
    </>
  );
}
