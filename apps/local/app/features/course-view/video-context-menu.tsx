import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import { useRequestCreateBeat } from "@/features/beats/create-beat-dialog";
import { useVideoDialogs } from "@/features/video-menu/video-dialogs";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import { Suspense, use, type ReactNode } from "react";
import type { useFetcher } from "react-router";
import type { LoaderData, Section, Lesson, Video } from "./course-view-types";
import { useAutofillChaptersAction } from "./autofill-chapters-context";
import { VIDEO_WARNING_LABELS } from "./video-warning-labels";

interface VideoContextMenuProps {
  video: Video;
  section: Section;
  lesson: Lesson;
  data: LoaderData;
  dispatch: (action: courseViewReducer.Action) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
}

/**
 * A Video's right-click menu in the course view, shared between the expanded
 * thumbnail grid and the compact beat tree so right-clicking a Video offers
 * the same actions in both views. `children` is the trigger. The list itself
 * is `videoMenuGroups`, the one every Video menu in the app renders.
 */
export function VideoContextMenu({
  children,
  ...props
}: VideoContextMenuProps & { children: ReactNode }) {
  const dialogs = useVideoDialogs();
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        {/* Purge Export shows only once the deferred export map says the
            Video is exported; until it streams in, the menu goes without. */}
        <Suspense
          fallback={
            <VideoMenu {...props} dialogs={dialogs} isExported={false} />
          }
        >
          <VideoMenuOnceExportKnown {...props} dialogs={dialogs} />
        </Suspense>
      </ContextMenu>
      {dialogs.dialogs}
    </>
  );
}

type MenuProps = VideoContextMenuProps & {
  dialogs: ReturnType<typeof useVideoDialogs>;
};

function VideoMenuOnceExportKnown(props: MenuProps) {
  const map = use(props.data.hasExportedVideoMap);
  return <VideoMenu {...props} isExported={!!map[props.video.id]} />;
}

function VideoMenu({
  video,
  section,
  lesson,
  data,
  dispatch,
  startExportUpload,
  revealVideoFetcher,
  submitDeleteVideo,
  dialogs,
  isExported,
}: MenuProps & { isExported: boolean }) {
  const openAutofillChapters = useAutofillChaptersAction();
  const requestCreateBeat = useRequestCreateBeat();
  const canEdit = data.isLatestVersion;
  const videoPath = `${section.title}/${lesson.path}/${video.title}`;
  const missingBody = video.warnings.some((w) => w.kind === "missingBody");

  return (
    <EntityMenuContent
      menu="context"
      entity={{ type: "video", id: video.id }}
      groups={videoMenuGroups({
        revealInFileSystem: () =>
          revealVideoFetcher.submit(
            {},
            { method: "post", action: `/api/videos/${video.id}/reveal` }
          ),
        ...(canEdit && {
          rename: () =>
            dispatch({
              type: "open-rename-video",
              videoId: video.id,
              videoTitle: video.title,
            }),
          editLessonBody: {
            onSelect: () =>
              dispatch({ type: "open-lesson-body-writer", videoId: video.id }),
            description: missingBody
              ? VIDEO_WARNING_LABELS.missingBody
              : undefined,
          },
          editScript: () =>
            dispatch({ type: "open-script-editor", videoId: video.id }),
          autofillDescription: () =>
            dispatch({ type: "open-seo-description", videoId: video.id }),
          autofillChapters:
            video.clipCount > 0
              ? () =>
                  openAutofillChapters({
                    videoId: video.id,
                    videoLabel: videoPath,
                  })
              : undefined,
          addBeat: (kind) =>
            requestCreateBeat({ videoId: video.id, kind, beforeBeatId: null }),
          duplicate: () =>
            dispatch({
              type: "open-copy-video",
              videoId: video.id,
              videoTitle: video.title,
              clipCount: video.clipCount,
              beatCount: video.beats.length,
              hasScript: video.hasScript,
            }),
          moveToLesson: () =>
            dispatch({
              type: "open-move-video",
              videoId: video.id,
              videoTitle: video.title,
              currentLessonId: lesson.id,
            }),
          purgeExport: isExported
            ? () => dialogs.confirmPurgeExport(video)
            : undefined,
          archive: () => submitDeleteVideo(video.id),
        }),
        export: () => startExportUpload(video.id, videoPath),
      })}
    />
  );
}
