"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { FeatureFlagService } from "@/services/feature-flag-service";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { VideoPostingLayout } from "@/features/video-posting/video-posting-layout";
import { SocialPagePanel } from "@/features/video-posting/social-page";
import type { Route } from "./+types/_app.videos.$videoId.social";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ctx = yield* loadVideoPostingContext(params.videoId!);
      const featureFlags = yield* FeatureFlagService;
      const showSocialShareButtons = featureFlags.isEnabled(
        "ENABLE_SOCIAL_SHARE_BUTTONS"
      );
      return { ...ctx, showSocialShareButtons };
    }),
});

export default function SocialRoute(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    showSocialShareButtons,
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
        <SocialPagePanel
          videoId={videoId}
          chapters={ctx.chapters}
          enabledSections={ctx.enabledSections}
          enabledFiles={ctx.enabledFiles}
          includeTranscript={ctx.includeTranscript}
          includeCourseStructure={ctx.includeCourseStructure}
          courseStructure={ctx.courseStructure}
          showSocialShareButtons={showSocialShareButtons}
        />
      )}
    </VideoPostingLayout>
  );
}
