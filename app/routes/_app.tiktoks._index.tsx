import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { getShortStatus, STATUS_META } from "@/lib/short-status";
import { formatSecondsToTimeCode } from "@/services/utils";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import { Clapperboard, Plus, VideoIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/_app.tiktoks._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - TikToks" }];
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
      const postedMap: Record<string, boolean> = {};
      yield* Effect.forEach(shorts, (video) =>
        Effect.gen(function* () {
          const mp4Path = `${finishedDir}/${video.id}.mp4`;
          exportedMap[video.id] = yield* fs.exists(mp4Path);

          const posts = yield* videoPostOps.listByVideoId(video.id);
          postedMap[video.id] = posts.some((p) => p.postedAt !== null);
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

export default function TikToksIndex(props: Route.ComponentProps) {
  const { shorts, exportedMap, postedMap } = props.loaderData;

  useFocusRevalidate({ enabled: true });

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Clapperboard className="w-6 h-6" />
              TikToks
            </h1>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <RecordTile />
            {shorts.map((video) => {
              const status = getShortStatus(video.id, exportedMap, postedMap);
              const StatusIcon = STATUS_META[status].icon;
              const totalDuration = video.clips.reduce(
                (acc, clip) =>
                  acc + (clip.sourceEndTime - clip.sourceStartTime),
                0
              );

              return (
                <Link
                  key={video.id}
                  to={`/videos/${video.id}/edit`}
                  className="group flex flex-col rounded-lg border bg-card overflow-hidden hover:border-foreground/20 transition-colors"
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
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
