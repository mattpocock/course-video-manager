"use client";

export const handle = { fullscreen: true };

import { loadVideoPostingContext } from "@/services/video-posting-context.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId.post";
import { CoursePublishService } from "@/services/course-publish-service";
import { VideoOffIcon } from "lucide-react";
import { PostPage } from "@/features/video-posting/post-page";
import { VideoPostingLayout } from "@/features/video-posting/video-posting-layout";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const ctx = yield* loadVideoPostingContext(videoId);
      const linkAuthOps = yield* LinkAuthOperationsService;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const pitchOps = yield* PitchOperationsService;
      const publishService = yield* CoursePublishService;

      const [youtubeAuth, videoThumbnails, videoExists] = yield* Effect.all(
        [
          linkAuthOps.getYoutubeAuth(),
          thumbnailOps.getThumbnailsByVideoId(videoId),
          publishService.isExported(videoId),
        ],
        { concurrency: "unbounded" }
      );

      const pitch = ctx.pitchId
        ? yield* pitchOps
            .getPitch(ctx.pitchId)
            .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null)))
        : null;

      return {
        ...ctx,
        videoExists,
        isYoutubeAuthenticated: youtubeAuth !== null,
        thumbnails: videoThumbnails,
        pitchYoutubeTitle: pitch?.youtubeTitle ?? null,
      };
    }),
});

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 1;
    }
  }, [props.src, ref.current]);

  return (
    <video
      src={props.src}
      className="w-full"
      controls
      preload="none"
      ref={ref}
    />
  );
};

export default function PostPageRoute(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    files,
    isStandalone,
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    isYoutubeAuthenticated,
    thumbnails,
    videoExists,
    pitchYoutubeTitle,
  } = props.loaderData;

  const revealVideoFetcher = useFetcher();

  return (
    <VideoPostingLayout
      videoId={videoId}
      files={files}
      isStandalone={isStandalone}
      transcriptWordCount={transcriptWordCount}
      chapters={chapters}
      links={links}
      courseStructure={courseStructure}
      videoSlot={
        videoExists ? (
          <Video src={`/api/videos/${videoId}/stream`} />
        ) : (
          <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
            <VideoOffIcon className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm text-center px-4">
              Video file not found on disk.
            </p>
          </div>
        )
      }
      onRevealInFileSystem={
        videoExists
          ? () => {
              revealVideoFetcher.submit(
                {},
                {
                  method: "post",
                  action: `/api/videos/${videoId}/reveal`,
                }
              );
            }
          : undefined
      }
    >
      {(ctx) => (
        <PostPage
          videoId={videoId}
          isYoutubeAuthenticated={isYoutubeAuthenticated}
          thumbnails={thumbnails}
          enabledFiles={ctx.enabledFiles}
          enabledSections={ctx.enabledSections}
          includeTranscript={ctx.includeTranscript}
          courseStructure={ctx.courseStructure}
          includeCourseStructure={ctx.includeCourseStructure}
          chapters={ctx.chapters}
          pitchYoutubeTitle={pitchYoutubeTitle}
        />
      )}
    </VideoPostingLayout>
  );
}
