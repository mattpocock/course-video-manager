import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { formatSecondsToTimeCode } from "@/services/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import { AlertTriangle, FileVideo } from "lucide-react";
import { Suspense } from "react";
import { Link, useNavigate, useFetcher } from "react-router";
import type { LoaderData, Section, Lesson, Video } from "./course-view-types";
import { UnexportedDot } from "./export-status";
import { VideoContextMenuItems } from "./video-context-menu";
import { videoWarningLabel } from "./video-warning-labels";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function VideoThumbnailItem({
  video,
  section,
  lesson,
  data,
  navigate,
  dispatch,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  submitDeleteVideo,
}: {
  video: Video;
  section: Section;
  lesson: Lesson;
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  dispatch: (action: courseViewReducer.Action) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
}) {
  const isReadOnly = !data.isLatestVersion;
  const totalDuration = video.totalDuration;
  const showWarning = !isReadOnly && video.warnings.length > 0;
  const warningLabel = videoWarningLabel(video.warnings);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to={`/videos/${video.id}/edit`}
          className="text-left items-center group/thumb bg-muted rounded overflow-hidden inline-flex"
        >
          <div className="relative aspect-video w-32 bg-muted">
            {video.firstClipId ? (
              <img
                src={`/clips/${video.firstClipId}/first-frame`}
                alt={video.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center border-r">
                <FileVideo className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}
            <Suspense>
              <UnexportedDot
                videoId={video.id}
                hasExportedVideoMap={data.hasExportedVideoMap}
              />
            </Suspense>
          </div>
          <div className="py-1 px-6 flex flex-col items-center text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="text-xs truncate text-foreground transition-colors">
                {video.title}
              </span>
              {showWarning && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center rounded-sm bg-amber-500/15 p-0.5 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{warningLabel}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <span className="text-xs font-mono mt-0.5">
              {formatSecondsToTimeCode(totalDuration)}
            </span>
          </div>
        </Link>
      </ContextMenuTrigger>
      <VideoContextMenuItems
        video={video}
        section={section}
        lesson={lesson}
        data={data}
        navigate={navigate}
        dispatch={dispatch}
        startExportUpload={startExportUpload}
        revealVideoFetcher={revealVideoFetcher}
        deleteVideoFileFetcher={deleteVideoFileFetcher}
        submitDeleteVideo={submitDeleteVideo}
      />
    </ContextMenu>
  );
}

export function VideoThumbnailGrid({
  videos,
  section,
  lesson,
  data,
  navigate,
  dispatch,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  submitDeleteVideo,
}: {
  videos: Video[];
  section: Section;
  lesson: Lesson;
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  dispatch: (action: courseViewReducer.Action) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
}) {
  if (videos.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-4">
      {videos.map((video) => (
        <VideoThumbnailItem
          key={video.id}
          video={video}
          section={section}
          lesson={lesson}
          data={data}
          navigate={navigate}
          dispatch={dispatch}
          startExportUpload={startExportUpload}
          revealVideoFetcher={revealVideoFetcher}
          deleteVideoFileFetcher={deleteVideoFileFetcher}
          submitDeleteVideo={submitDeleteVideo}
        />
      ))}
    </div>
  );
}
