"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { VideoPostingLayout } from "@/features/video-posting/video-posting-layout";
import { NewsletterPagePanel } from "@/features/video-posting/newsletter-page";
import type { Route } from "./+types/_app.videos.$videoId.newsletter";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ctx = yield* loadVideoPostingContext(params.videoId!);
      const kitSequenceUrl =
        process.env.KIT_SEQUENCE_URL || "https://app.kit.com/sequences/2625552";
      return { ...ctx, kitSequenceUrl };
    }),
});

export default function NewsletterRoute(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    kitSequenceUrl,
  } = props.loaderData;

  return (
    <VideoPostingLayout
      videoId={videoId}
      files={files}
      isStandalone={isStandalone}
      transcriptWordCount={transcriptWordCount}
      chapters={chapters}
      links={links}
      courseStructure={courseStructure}
    >
      {(ctx) => (
        <NewsletterPagePanel
          videoId={videoId}
          chapters={ctx.chapters}
          enabledSections={ctx.enabledSections}
          enabledFiles={ctx.enabledFiles}
          includeTranscript={ctx.includeTranscript}
          includeCourseStructure={ctx.includeCourseStructure}
          courseStructure={ctx.courseStructure}
          kitSequenceUrl={kitSequenceUrl}
        />
      )}
    </VideoPostingLayout>
  );
}
