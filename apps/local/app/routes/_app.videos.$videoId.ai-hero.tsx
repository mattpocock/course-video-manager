"use client";

export const handle = { fullscreen: true };

import {
  loadVideoPostingContext,
  loadWriterContext,
} from "@/services/video-posting-context.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { WriterContextData } from "@/services/video-posting-context.server";
import { VideoContextPanel } from "@/components/video-context-panel";
import { usePostingContextPanel } from "@/features/video-posting/posting-context-panel";
import { toast } from "@/components/ui/toast";
import type { Route } from "./+types/_app.videos.$videoId.ai-hero";
import { AiHeroPage } from "@/features/video-posting/ai-hero-page";
import { useWriterContext } from "@/features/article-writer/use-writer-context";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ctx = yield* loadVideoPostingContext(params.videoId!);
      const linkAuthOps = yield* LinkAuthOperationsService;
      const aiHeroAuth = yield* linkAuthOps.getAiHeroAuth();
      const aiHero: { connected: true; userId: string } | { connected: false } =
        aiHeroAuth
          ? { connected: true, userId: aiHeroAuth.userId }
          : { connected: false };
      const writerContextPromise: Promise<WriterContextData> =
        runtimeLive.runPromise(loadWriterContext(params.videoId!));
      return { ...ctx, aiHero, writerContextPromise };
    }),
});

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src, ref.current]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

export default function AiHeroPostPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    aiHero,
    writerContextPromise,
  } = props.loaderData;

  const writerContext = useWriterContext(writerContextPromise);

  const {
    state: contextPanel,
    panelProps,
    modals,
  } = usePostingContextPanel({
    videoId,
    files,
    chapters,
  });

  // Delete link fetcher
  const deleteLinkFetcher = useFetcher();
  const openFolderFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          {...panelProps}
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          chapters={chapters}
          courseStructure={courseStructure}
          files={files}
          onOpenFolderClick={() => {
            openFolderFetcher.submit(null, {
              method: "post",
              action: `/api/videos/${videoId}/open-folder`,
            });
          }}
          links={links}
          onDeleteLink={(linkId) => {
            deleteLinkFetcher.submit(null, {
              method: "post",
              action: `/api/links/${linkId}/delete`,
            });
          }}
          videoSlot={<Video src={`/api/videos/${videoId}/stream`} />}
        />

        {/* Right panel: AI Hero post form */}
        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <AiHeroPage
            videoId={videoId}
            aiHero={aiHero}
            enabledFiles={contextPanel.enabledFiles}
            enabledSections={contextPanel.enabledSections}
            includeTranscript={contextPanel.includeTranscript}
            courseStructure={courseStructure}
            includeCourseStructure={contextPanel.includeCourseStructure}
            chapters={chapters}
            writerContext={writerContext}
          />
        </div>
      </div>

      {modals}
    </>
  );
}
