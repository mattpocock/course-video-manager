"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { VideoContextPanel } from "@/components/video-context-panel";
import { usePostingContextPanel } from "@/features/video-posting/posting-context-panel";
import { NewsletterPagePanel } from "@/features/video-posting/newsletter-page";
import type { Route } from "./+types/_app.videos.$videoId.newsletter";
import { toast } from "@/components/ui/toast";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ctx = yield* loadVideoPostingContext(params.videoId!);
      const kitSequenceUrl =
        process.env.KIT_SEQUENCE_URL || "https://app.kit.com/sequences/2625552";
      return { ...ctx, kitSequenceUrl };
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

export default function NewsletterPage(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    kitSequenceUrl,
  } = props.loaderData;

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

        {/* Right panel: Newsletter interface */}
        <NewsletterPagePanel
          videoId={videoId}
          chapters={chapters}
          enabledSections={contextPanel.enabledSections}
          enabledFiles={contextPanel.enabledFiles}
          includeTranscript={contextPanel.includeTranscript}
          includeCourseStructure={contextPanel.includeCourseStructure}
          courseStructure={courseStructure}
          kitSequenceUrl={kitSequenceUrl}
        />
      </div>

      {modals}
    </>
  );
}
