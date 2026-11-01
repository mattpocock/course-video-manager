import { AddStandaloneVideoModal } from "@/components/add-standalone-video-modal";
import { Button } from "@/components/ui/button";
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
import { useUploadActions } from "@/features/upload-manager/upload-context";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { formatDuration } from "@/lib/format-duration";
import { CoursePublishReadService } from "@/services/course-publish-reads";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { Archive, Plus, VideoIcon, VideoOffIcon } from "lucide-react";
import { useState } from "react";
import {
  Link,
  useFetcher,
  useNavigate,
  useSearchParams,
  type ShouldRevalidateFunction,
} from "react-router";
import type { Route } from "./+types/_app.videos._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Videos" }];
};

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const publishService = yield* CoursePublishReadService;

      const [videos, archivedVideos] = yield* Effect.all(
        [
          videoOps.getAllStandaloneVideos({ format: "landscape" }),
          videoOps.getArchivedStandaloneVideos({ format: "landscape" }),
        ],
        { concurrency: "unbounded" }
      );

      const hasExportedVideoMap: Record<string, boolean> = {};
      yield* Effect.forEach([...videos, ...archivedVideos], (video) => {
        return Effect.gen(function* () {
          hasExportedVideoMap[video.id] =
            yield* publishService.isExported(video);
        });
      });

      return {
        videos,
        archivedVideos,
        hasExportedVideoMap,
      };
    }),
});

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

export default function Component(props: Route.ComponentProps) {
  const { hasExportedVideoMap } = props.loaderData;
  const [searchParams] = useSearchParams();
  const query = searchQueryOf(searchParams);
  const searching = isSearching(query);
  const videos = searchVideos(props.loaderData.videos, query);
  // Search shows only Videos still being worked on.
  const archivedVideos = searching ? [] : props.loaderData.archivedVideos;
  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const navigate = useNavigate();
  const revealVideoFetcher = useFetcher();
  const { startExportUpload } = useUploadActions();
  const dialogs = useVideoDialogs();

  useFocusRevalidate({ enabled: true });

  /** One Video's row: a link to its editor, right-click for its actions. */
  const renderRow = (
    video: (typeof videos)[number],
    { archived }: { archived: boolean }
  ) => {
    const totalDuration = video.clips.reduce((acc, clip) => {
      return acc + (clip.sourceEndTime - clip.sourceStartTime);
    }, 0);
    const isExported = hasExportedVideoMap[video.id];

    return (
      <ContextMenu key={video.id}>
        <ContextMenuTrigger asChild>
          <Link
            to={`/videos/${video.id}/edit`}
            className="flex items-center justify-between border rounded-lg px-4 py-3 hover:bg-muted/50 transition-colors cursor-context-menu"
          >
            <div className="flex items-center gap-3">
              {isExported ? (
                <VideoIcon className="w-5 h-5 flex-shrink-0" />
              ) : (
                <VideoOffIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
              )}
              <span className="font-medium">{video.title}</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {formatDuration(totalDuration)}
            </span>
          </Link>
        </ContextMenuTrigger>
        <EntityMenuContent
          menu="context"
          entity={{ type: "video", id: video.id }}
          groups={videoMenuGroups({
            revealInFileSystem: () =>
              revealVideoFetcher.submit(
                {},
                { method: "post", action: `/api/videos/${video.id}/reveal` }
              ),
            rename: () => dialogs.rename(video),
            moveToCourse: archived
              ? undefined
              : () => navigate(`/videos/${video.id}/move-to-course`),
            export: () => startExportUpload(video.id, video.title),
            purgeExport: isExported
              ? () => dialogs.confirmPurgeExport(video)
              : undefined,
            // An archived Video offers the way back instead of the way in.
            unarchive: archived ? () => dialogs.unarchive(video) : undefined,
            archive: archived ? undefined : () => dialogs.archive(video),
          })}
        />
      </ContextMenu>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <VideoIcon className="w-6 h-6" />
              Standalone Videos
            </h1>
            <div className="flex items-center gap-2">
              <Button onClick={() => setIsAddVideoOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Video
              </Button>
            </div>
          </div>

          {dialogs.dialogs}

          <div className="mb-6">
            <ListSearchBox placeholder="Search Standalone Videos by title" />
          </div>

          {videos.length === 0 && searching ? (
            <p className="text-center py-12 text-muted-foreground">
              No matches
            </p>
          ) : videos.length === 0 ? (
            <div className="text-center py-12">
              <VideoIcon className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                No standalone videos
              </h3>
              <p className="text-muted-foreground">
                Standalone videos are videos not attached to any lesson.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {videos.map((video) => renderRow(video, { archived: false }))}
            </div>
          )}

          {archivedVideos.length > 0 && (
            <div className="mt-12">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                <Archive className="w-5 h-5" />
                Archived Videos
              </h2>
              <div className="space-y-2">
                {archivedVideos.map((video) =>
                  renderRow(video, { archived: true })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <AddStandaloneVideoModal
        open={isAddVideoOpen}
        onOpenChange={setIsAddVideoOpen}
      />
    </div>
  );
}
