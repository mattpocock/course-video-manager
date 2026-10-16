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
import { toast } from "@/components/ui/toast";
import type { Route } from "./+types/_app.videos.$videoId.post";
import { VideoContextPanel } from "@/components/video-context-panel";
import { usePostingContextPanel } from "@/features/video-posting/posting-context-panel";
import { CoursePublishReadService } from "@/services/course-publish-reads";
import { VideoOffIcon } from "lucide-react";
import { PostPage } from "@/features/video-posting/post-page";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const ctx = yield* loadVideoPostingContext(videoId);
      const linkAuthOps = yield* LinkAuthOperationsService;
      const thumbnailOps = yield* ThumbnailOperationsService;
      const pitchOps = yield* PitchOperationsService;
      const publishService = yield* CoursePublishReadService;

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
    transcriptWordCount,
    chapters,
    links,
    courseStructure,
    isYoutubeAuthenticated,
    thumbnails,
    videoExists,
    pitchYoutubeTitle,
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
  const revealVideoFetcher = useFetcher();

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
        />

        {/* Right panel: Tabbed posting interface */}
        <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
          <PostPage
            videoId={videoId}
            isYoutubeAuthenticated={isYoutubeAuthenticated}
            thumbnails={thumbnails}
            enabledFiles={contextPanel.enabledFiles}
            enabledSections={contextPanel.enabledSections}
            includeTranscript={contextPanel.includeTranscript}
            courseStructure={courseStructure}
            includeCourseStructure={contextPanel.includeCourseStructure}
            chapters={chapters}
            pitchYoutubeTitle={pitchYoutubeTitle}
          />
        </div>
      </div>

      {modals}
    </>
  );
}
