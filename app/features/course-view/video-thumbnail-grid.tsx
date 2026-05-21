import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { formatSecondsToTimeCode } from "@/services/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import {
  AlertTriangle,
  ArrowRightLeft,
  Combine,
  Download,
  FileVideo,
  FileX,
  FolderOpen,
  PencilIcon,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import { use } from "react";
import { Link, useNavigate, useFetcher } from "react-router";
import type { LoaderData, Section, Lesson, Video } from "./course-view-types";
import { useGenerateChaptersAction } from "./generate-chapters-context";
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
  const hasExportedVideoMap = use(data.hasExportedVideoMap);
  const isReadOnly = !data.isLatestVersion;
  const totalDuration = video.totalDuration;
  const openGenerateChapters = useGenerateChaptersAction();
  const showWarning =
    !isReadOnly &&
    video.warnings.some((w) => w.kind === "missingOpeningChapter");
  const canGenerateChapters = !isReadOnly && video.clipCount > 0;

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
                alt={video.path}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center border-r">
                <FileVideo className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}
            {!hasExportedVideoMap[video.id] && (
              <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-red-500" />
            )}
          </div>
          <div className="py-1 px-6 flex flex-col items-center text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="text-xs truncate text-foreground transition-colors">
                {video.path}
              </span>
              {showWarning && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center rounded-sm bg-amber-500/15 p-0.5 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Missing opening section</TooltipContent>
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
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-video-player",
              videoId: video.id,
              videoPath: `${section.path}/${lesson.path}/${video.path}`,
            });
          }}
        >
          <Play className="w-4 h-4" />
          Play Video
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            startExportUpload(
              video.id,
              `${section.path}/${lesson.path}/${video.path}`
            );
          }}
        >
          <Download className="w-4 h-4" />
          Export
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            navigate(`/videos/concatenate?initial=${video.id}`);
          }}
        >
          <Combine className="w-4 h-4" />
          Create Concatenated Video
        </ContextMenuItem>
        {canGenerateChapters && (
          <ContextMenuItem
            onSelect={() => {
              openGenerateChapters({
                videoId: video.id,
                videoLabel: `${section.path}/${lesson.path}/${video.path}`,
              });
            }}
          >
            <Sparkles className="w-4 h-4" />
            Generate Chapters
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onSelect={() => {
            revealVideoFetcher.submit(
              {},
              {
                method: "post",
                action: `/api/videos/${video.id}/reveal`,
              }
            );
          }}
        >
          <FolderOpen className="w-4 h-4" />
          Reveal in File System
        </ContextMenuItem>
        {!isReadOnly && (
          <>
            <ContextMenuItem
              onSelect={() => {
                dispatch({
                  type: "open-rename-video",
                  videoId: video.id,
                  videoPath: video.path,
                });
              }}
            >
              <PencilIcon className="w-4 h-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                dispatch({
                  type: "open-move-video",
                  videoId: video.id,
                  videoPath: video.path,
                  currentLessonId: lesson.id,
                });
              }}
            >
              <ArrowRightLeft className="w-4 h-4" />
              Move to Lesson
            </ContextMenuItem>
            {hasExportedVideoMap[video.id] && (
              <ContextMenuItem
                variant="destructive"
                onSelect={() => {
                  deleteVideoFileFetcher.submit(
                    {},
                    {
                      method: "post",
                      action: `/api/videos/${video.id}/purge-export`,
                    }
                  );
                }}
              >
                <FileX className="w-4 h-4" />
                Purge Export
              </ContextMenuItem>
            )}
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
                submitDeleteVideo(video.id);
              }}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
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
