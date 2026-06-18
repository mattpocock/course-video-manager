"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { VideoPostingLayout } from "@/features/video-posting/video-posting-layout";
import { SkillsChangelogPage } from "@/features/video-posting/skills-changelog-page";
import type { Route } from "./+types/_app.videos.$videoId.skills-changelog";

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
      return { ...ctx, aiHero };
    }),
});

export default function SkillsChangelogRoute(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    aiHero,
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
        <SkillsChangelogPage
          videoId={videoId}
          aiHero={aiHero}
          enabledFiles={ctx.enabledFiles}
          enabledSections={ctx.enabledSections}
          includeTranscript={ctx.includeTranscript}
          courseStructure={ctx.courseStructure}
          includeCourseStructure={ctx.includeCourseStructure}
          chapters={ctx.chapters}
        />
      )}
    </VideoPostingLayout>
  );
}
