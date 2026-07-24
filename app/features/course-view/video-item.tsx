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
  Copy,
  Download,
  FolderOpen,
  PencilIcon,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Suspense } from "react";
import { Link, useNavigate, useFetcher } from "react-router";
import type { LoaderData, Section, Lesson, Video } from "./course-view-types";
import { useGenerateChaptersAction } from "./generate-chapters-context";
import { videoWarningLabel } from "./video-warning-labels";
import {
  PurgeExportMenuItem,
  VideoExportIcon,
  VideoExportIconFallback,
} from "./export-status";

export function VideoItem({
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
  const openGenerateChapters = useGenerateChaptersAction();
  const totalDuration = video.totalDuration;
  const isLatestVersion = data.isLatestVersion;
  const showWarning = isLatestVersion && video.warnings.length > 0;
  const warningLabel = videoWarningLabel(video.warnings);
  const canGenerateChapters = isLatestVersion && video.clipCount > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to={`/videos/${video.id}/edit`}
          className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors cursor-context-menu w-full text-left"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Suspense fallback={<VideoExportIconFallback />}>
              <VideoExportIcon
                videoId={video.id}
                hasExportedVideoMap={data.hasExportedVideoMap}
              />
            </Suspense>
            <span className="truncate text-muted-foreground">
              {video.title}
            </span>
          </div>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            {showWarning && (
              <AlertTriangle
                className="w-3 h-3 text-amber-500"
                aria-label={warningLabel}
              />
            )}
            <span className="text-muted-foreground font-mono">
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
              videoTitle: `${section.title}/${lesson.path}/${video.title}`,
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
              `${section.title}/${lesson.path}/${video.title}`
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
                videoLabel: `${section.title}/${lesson.path}/${video.title}`,
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
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-rename-video",
              videoId: video.id,
              videoTitle: video.title,
            });
          }}
        >
          <PencilIcon className="w-4 h-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-copy-video",
              videoId: video.id,
              videoTitle: video.title,
              clipCount: video.clipCount,
              beatCount: video.beats.length,
              hasScript: video.hasScript,
            });
          }}
        >
          <Copy className="w-4 h-4" />
          Copy Video
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-move-video",
              videoId: video.id,
              videoTitle: video.title,
              currentLessonId: lesson.id,
            });
          }}
        >
          <ArrowRightLeft className="w-4 h-4" />
          Move to Lesson
        </ContextMenuItem>
        <Suspense>
          <PurgeExportMenuItem
            videoId={video.id}
            hasExportedVideoMap={data.hasExportedVideoMap}
            deleteVideoFileFetcher={deleteVideoFileFetcher}
          />
        </Suspense>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            submitDeleteVideo(video.id);
          }}
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
