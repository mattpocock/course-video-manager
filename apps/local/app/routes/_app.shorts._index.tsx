import { DeleteVideoModal } from "@/components/delete-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ShortsPostingModal,
  type ShortsPostingMode,
} from "@/features/video-posting/shorts-posting-modal";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { useUploadRevalidate } from "@/hooks/use-upload-revalidate";
import {
  getShortStatus,
  STATUS_META,
  type PostedPlatforms,
} from "@/lib/short-status";
import { SiYoutube, SiTiktok } from "@icons-pack/react-simple-icons";
import { formatSecondsToTimeCode } from "@/services/utils";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import {
  Clapperboard,
  Download,
  FolderOpen,
  PencilIcon,
  Plus,
  SendIcon,
  Trash2,
  VideoIcon,
} from "lucide-react";
import { useContext, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/_app.shorts._index";

const POST_OPTIONS: Array<{
  label: string;
  mode: ShortsPostingMode;
}> = [
  { label: "Post Short", mode: "both" },
  { label: "Post to YouTube", mode: "youtube" },
  { label: "Post to TikTok", mode: "tiktok" },
];

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Shorts" }];
};

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const videoPostOps = yield* VideoPostOperationsService;
      const fs = yield* FileSystem.FileSystem;
      const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");

      const shorts = yield* videoOps.getAllStandaloneVideos({
        format: "short",
      });

      const exportedMap: Record<string, boolean> = {};
      const postedMap: Record<string, PostedPlatforms> = {};
      yield* Effect.forEach(shorts, (video) =>
        Effect.gen(function* () {
          const mp4Path = `${finishedDir}/${video.id}.mp4`;
          exportedMap[video.id] = yield* fs.exists(mp4Path);

          const posts = yield* videoPostOps.listByVideoId(video.id);
          postedMap[video.id] = {
            youtube: posts.some(
              (p) => p.platform === "youtube-shorts" && p.postedAt !== null
            ),
            tiktok: posts.some(
              (p) => p.platform === "buffer" && p.postedAt !== null
            ),
          };
        })
      );

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
        const formData = new FormData();
        formData.set("title", `Short ${new Date().toLocaleDateString()}`);
        formData.set("format", "short");
        formData.set("redirectTo", "/videos/{id}/edit");
        fetcher.submit(formData, {
          method: "post",
          action: "/api/videos/create",
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

export default function ShortsIndex(props: Route.ComponentProps) {
  const { shorts, exportedMap, postedMap } = props.loaderData;
  const [videoToDelete, setVideoToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [videoToRename, setVideoToRename] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [videoToPost, setVideoToPost] = useState<{
    id: string;
    title: string;
    mode: ShortsPostingMode;
  } | null>(null);
  const revealFetcher = useFetcher();
  const { startExportUpload } = useContext(UploadContext);

  useFocusRevalidate({ enabled: true });
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

          {videoToDelete && (
            <DeleteVideoModal
              videoId={videoToDelete.id}
              videoTitle={videoToDelete.title}
              open={true}
              onOpenChange={(open) => {
                if (!open) setVideoToDelete(null);
              }}
            />
          )}

          {videoToRename && (
            <RenameVideoModal
              videoId={videoToRename.id}
              currentName={videoToRename.title}
              open={true}
              onOpenChange={(open) => {
                if (!open) setVideoToRename(null);
              }}
            />
          )}

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
                            {formatSecondsToTimeCode(totalDuration)}
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
                  <ContextMenuContent>
                    {POST_OPTIONS.map((option) => (
                      <ContextMenuItem
                        key={option.mode}
                        onSelect={() =>
                          setVideoToPost({
                            id: video.id,
                            title: video.title,
                            mode: option.mode,
                          })
                        }
                      >
                        <SendIcon className="w-4 h-4" />
                        {option.label}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        setVideoToRename({
                          id: video.id,
                          title: video.title,
                        })
                      }
                    >
                      <PencilIcon className="w-4 h-4" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => startExportUpload(video.id, video.title)}
                    >
                      <Download className="w-4 h-4" />
                      Export
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        revealFetcher.submit(
                          {},
                          {
                            method: "post",
                            action: `/api/videos/${video.id}/reveal`,
                          }
                        )
                      }
                    >
                      <FolderOpen className="w-4 h-4" />
                      Reveal in File System
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() =>
                        setVideoToDelete({
                          id: video.id,
                          title: video.title,
                        })
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
