import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { useVideoDialogs } from "@/features/video-menu/video-dialogs";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import {
  NEW_STREAM_VIDEO_ACTION,
  newStreamVideoFormData,
  streamingUrl,
} from "@/features/streaming/new-stream-video";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { formatDuration } from "@/lib/format-duration";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { Plus, RadioIcon, VideoIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/_app.streaming._index";

export const meta: Route.MetaFunction = () => [{ title: "CVM - Streaming" }];

/** The Videos a stream may record into: standalone Landscape ones, never a Short. */
export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const videos = yield* videoOps.getAllStandaloneVideos({
        format: "landscape",
      });
      return { videos };
    }),
});

/** The Streaming tab's Video picker, and its New Video. */
export default function StreamingIndex(props: Route.ComponentProps) {
  const { videos } = props.loaderData;
  const createFetcher = useFetcher();
  const revealFetcher = useFetcher();
  const dialogs = useVideoDialogs();
  const isCreating = createFetcher.state !== "idle";

  useFocusRevalidate({ enabled: true });

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <RadioIcon className="w-6 h-6" />
              Streaming
            </h1>
            <Button
              disabled={isCreating}
              onClick={() =>
                void createFetcher.submit(newStreamVideoFormData(), {
                  method: "post",
                  action: NEW_STREAM_VIDEO_ACTION,
                })
              }
            >
              <Plus className="w-4 h-4 mr-2" />
              {isCreating ? "Creating…" : "New Video"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-8">
            Pick the Landscape Video the stream records into, or start a new
            one.
          </p>

          {dialogs.dialogs}

          {videos.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">
              No standalone Landscape Videos yet.
            </p>
          ) : (
            <div className="space-y-2">
              {videos.map((video) => (
                <ContextMenu key={video.id}>
                  <ContextMenuTrigger asChild>
                    <Link
                      to={streamingUrl(video.id)}
                      className="flex items-center justify-between border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-context-menu"
                    >
                      <span className="flex items-center gap-3 font-medium">
                        <VideoIcon className="w-5 h-5 flex-shrink-0" />
                        {video.title}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatDuration(
                          video.clips.reduce(
                            (acc, clip) =>
                              acc + (clip.sourceEndTime - clip.sourceStartTime),
                            0
                          )
                        )}
                      </span>
                    </Link>
                  </ContextMenuTrigger>
                  <EntityMenuContent
                    menu="context"
                    entity={{ type: "video", id: video.id }}
                    groups={videoMenuGroups({
                      revealInFileSystem: () =>
                        void revealFetcher.submit(
                          {},
                          {
                            method: "post",
                            action: `/api/videos/${video.id}/reveal`,
                          }
                        ),
                      rename: () => dialogs.rename(video),
                      archive: () => dialogs.archive(video),
                    })}
                  />
                </ContextMenu>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
