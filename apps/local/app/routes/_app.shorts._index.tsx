import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { ListSearchBox } from "@/features/list-search/list-search-box";
import {
  isSearching,
  onlySearchChanged,
  searchQueryOf,
  searchVideos,
} from "@/features/list-search/list-search";
import { useVideoDialogs } from "@/features/video-menu/video-dialogs";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import {
  ShortsPostingModal,
  type ShortsPostingMode,
} from "@/features/video-posting/shorts-posting-modal";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { useUploadRevalidate } from "@/hooks/use-upload-revalidate";
import {
  getPostedPlatforms,
  getShortStatus,
  STATUS_META,
  type PostedPlatforms,
} from "@/lib/short-status";
import { SiYoutube, SiTiktok } from "@icons-pack/react-simple-icons";
import { formatDuration } from "@/lib/format-duration";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect, Option } from "effect";
import { findExportedVideo } from "@/services/finished-videos.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { Clapperboard, Plus, VideoIcon } from "lucide-react";
import { useState } from "react";
import {
  Link,
  useFetcher,
  useSearchParams,
  type ShouldRevalidateFunction,
} from "react-router";
import { NEW_SHORT_ACTION, newShortFormData } from "@/lib/new-short";
import type { Route } from "./+types/_app.shorts._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Shorts" }];
};

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const videoPostOps = yield* VideoPostOperationsService;
      const storageRoots = yield* storageRootsConfig;

      const shorts = yield* videoOps.getAllStandaloneVideos({
        format: "short",
      });

      const exportedMap: Record<string, boolean> = {};
      const postedMap: Record<string, PostedPlatforms> = {};

      // One query for every Short's Video Posts (not one per Short), while
      // the Exported Video checks run alongside it, a few at a time so a
      // slow Storage Root is not sent every stat at once.
      const [posts] = yield* Effect.all(
        [
          videoPostOps.listByVideoIds(shorts.map((video) => video.id)),
          Effect.forEach(
            shorts,
            (video) =>
              Effect.map(
                findExportedVideo(storageRoots, `${video.id}.mp4`),
                (found) => {
                  exportedMap[video.id] = Option.isSome(found);
                }
              ),
            { concurrency: 8, discard: true }
          ),
        ],
        { concurrency: "unbounded" }
      );

      const postsByVideo = Map.groupBy(posts, (post) => post.videoId);
      for (const video of shorts) {
        postedMap[video.id] = getPostedPlatforms(
          postsByVideo.get(video.id) ?? []
        );
      }

      return { shorts, exportedMap, postedMap };
    }),
});

function RecordTile() {
  const fetcher = useFetcher();

  const isCreating = fetcher.state !== "idle";

  return (
    <button
      type="button"
      disabled={isCreating}
      onClick={() => {
        fetcher.submit(newShortFormData(), {
          method: "post",
          action: NEW_SHORT_ACTION,
        });
      }}
      className="group flex flex-col rounded-lg border border-dashed border-muted-foreground/30 bg-card overflow-hidden hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
    >
      <div className="aspect-[9/16] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground group-hover:text-foreground/70 transition-colors">
          <Plus className="w-8 h-8" />
          <span className="text-xs font-medium">
            {isCreating ? "Creating..." : "Record"}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Typing in the search box filters what is loaded: no reload (#2512). */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) =>
  formMethod === undefined && onlySearchChanged(currentUrl, nextUrl)
    ? false
    : defaultShouldRevalidate;

export default function ShortsIndex(props: Route.ComponentProps) {
  const { exportedMap, postedMap } = props.loaderData;
  const [searchParams] = useSearchParams();
  const query = searchQueryOf(searchParams);
  const shorts = searchVideos(props.loaderData.shorts, query);
  const [videoToPost, setVideoToPost] = useState<{
    id: string;
    title: string;
    mode: ShortsPostingMode;
  } | null>(null);
  const revealFetcher = useFetcher();
  const dialogs = useVideoDialogs();
  const { startExportUpload } = useUploadActions();

  useFocusRevalidate({ enabled: true });
  const post = (
    video: { id: string; title: string },
    mode: ShortsPostingMode
  ) => setVideoToPost({ id: video.id, title: video.title, mode });
  useUploadRevalidate([
    "buffer",
    "youtube-shorts",
    "render-vertical",
    "export",
  ]);

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clapperboard className="w-6 h-6" />
              Shorts
            </h1>
          </div>

          {dialogs.dialogs}

          <div className="mb-6">
            <ListSearchBox placeholder="Search Shorts by title" />
          </div>

          {videoToPost && (
            <ShortsPostingModal
              open={true}
              onOpenChange={(open) => {
                if (!open) setVideoToPost(null);
              }}
              videoId={videoToPost.id}
              videoTitle={videoToPost.title}
              mode={videoToPost.mode}
            />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <RecordTile />
            {shorts.map((video) => {
              const status = getShortStatus(video.id, exportedMap, postedMap);
              const StatusIcon = STATUS_META[status].icon;
              const posted = postedMap[video.id];
              const totalDuration = video.clips.reduce(
                (acc, clip) =>
                  acc + (clip.sourceEndTime - clip.sourceStartTime),
                0
              );

              return (
                <ContextMenu key={video.id}>
                  <ContextMenuTrigger asChild>
                    <Link
                      to={`/videos/${video.id}/edit`}
                      className="group flex flex-col rounded-lg border bg-card overflow-hidden hover:border-foreground/20 transition-colors cursor-context-menu"
                    >
                      <div className="aspect-[9/16] bg-muted/50 flex items-center justify-center relative">
                        {video.clips[0] ? (
                          <img
                            src={`/clips/${video.clips[0].id}/first-frame`}
                            alt={video.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <VideoIcon className="w-8 h-8 text-muted-foreground/30" />
                        )}
                        {totalDuration > 0 && (
                          <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                            {formatDuration(totalDuration)}
                          </div>
                        )}
                        {(posted?.youtube || posted?.tiktok) && (
                          <div className="absolute top-2 left-2 flex gap-1">
                            {posted?.youtube && (
                              <span
                                title="Posted to YouTube"
                                className="flex items-center justify-center bg-black/70 text-white rounded p-1"
                              >
                                <SiYoutube className="w-3 h-3" />
                              </span>
                            )}
                            {posted?.tiktok && (
                              <span
                                title="Posted to TikTok"
                                className="flex items-center justify-center bg-black/70 text-white rounded p-1"
                              >
                                <SiTiktok className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                          <StatusIcon className="w-3 h-3" />
                          {STATUS_META[status].label}
                        </span>
                        <p className="text-xs font-medium group-hover:text-foreground/80">
                          {video.title}
                        </p>
                      </div>
                    </Link>
                  </ContextMenuTrigger>
                  <EntityMenuContent
                    menu="context"
                    entity={{ type: "video", id: video.id }}
                    groups={videoMenuGroups({
                      revealInFileSystem: () =>
                        revealFetcher.submit(
                          {},
                          {
                            method: "post",
                            action: `/api/videos/${video.id}/reveal`,
                          }
                        ),
                      rename: () => dialogs.rename(video),
                      export: () => startExportUpload(video.id, video.title),
                      postShort: () => post(video, "both"),
                      postToYouTube: () => post(video, "youtube"),
                      postToTikTok: () => post(video, "tiktok"),
                      archive: () => dialogs.archive(video),
                    })}
                  />
                </ContextMenu>
              );
            })}
          </div>
          {shorts.length === 0 && isSearching(query) && (
            <p className="text-center py-12 text-muted-foreground">
              No matches
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
