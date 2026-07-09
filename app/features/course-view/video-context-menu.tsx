import {
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import {
  ArrowRightLeft,
  Combine,
  Copy,
  Download,
  FolderOpen,
  Link2,
  PencilIcon,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Suspense } from "react";
import type { useNavigate, useFetcher } from "react-router";
import type { LoaderData, Section, Lesson, Video } from "./course-view-types";
import { copyDeepLink } from "./deep-link";
import { useGenerateChaptersAction } from "./generate-chapters-context";
import { PurgeExportMenuItem } from "./export-status";
import { AddBeatSubMenu } from "@/features/beats/beat-menu-items";
import { useRequestCreateBeat } from "@/features/beats/create-beat-dialog";

/**
 * The full set of video context-menu items, shared between the expanded
 * thumbnail grid and the compact beat tree so right-clicking a Video offers
 * the same actions in both views. Wrap in a `<ContextMenu>`/`<ContextMenuTrigger>`
 * at the call site.
 */
export function VideoContextMenuItems({
  courseId,
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
  courseId: string;
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
  const requestCreateBeat = useRequestCreateBeat();
  const isReadOnly = !data.isLatestVersion;
  const canGenerateChapters = !isReadOnly && video.clipCount > 0;

  return (
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
        onSelect={() =>
          copyDeepLink({
            courseId,
            sectionId: section.id,
            videoId: video.id,
          })
        }
      >
        <Link2 className="w-4 h-4" />
        Copy Deep Link
      </ContextMenuItem>
      {!isReadOnly && (
        <>
          <AddBeatSubMenu
            onAdd={(kind) =>
              requestCreateBeat({
                videoId: video.id,
                kind,
                beforeBeatId: null,
              })
            }
          />
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
        </>
      )}
    </ContextMenuContent>
  );
}
