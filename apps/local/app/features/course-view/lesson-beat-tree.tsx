import { cn } from "@/lib/utils";
import { Link, type useFetcher } from "react-router";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { BeatList } from "@/features/beats/beat-list";
import { VideoContextMenu } from "./video-context-menu";
import { useCourseViewVisibility } from "./course-view-visibility";
import { VideoWarningIndicator } from "./video-warning-indicator";
import type { LoaderData, Lesson, Section, Video } from "./course-view-types";

/**
 * Compact-view text tree under a lesson: lesson → videos (sorted by name) →
 * ordered Beats. Always fully expanded (no collapsibility in V1). See
 * docs/adr/0015-video-level-segment-planning.md.
 */
/**
 * Callbacks/data the Video context menu needs, threaded down from the lesson
 * item so the compact tree's right-click menu matches the expanded view's.
 */
type VideoMenuProps = {
  section: Section;
  data: LoaderData;
  dispatch: (action: courseViewReducer.Action) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  submitDeleteVideo: (videoId: string) => void;
};

export function LessonBeatTree({
  lesson,
  isReadOnly,
  submitEvent,
  ...videoMenuProps
}: {
  lesson: Lesson;
  isReadOnly: boolean;
  submitEvent: (event: CourseEditorEvent) => void;
} & VideoMenuProps) {
  const videos = [...lesson.videos].sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  if (videos.length === 0) return null;

  // Drag-and-drop is wired by a single BeatDndProvider hoisted to the whole
  // compact grid (see SectionGrid), so a Beat can be dragged to any Video,
  // not just the ones inside this lesson. Here we only render the tree.
  return (
    <div
      className={cn(
        "mt-1 space-y-1",
        // Indent the video/beat text to start at the lesson title, so it
        // clears the icon-to-icon dependency spine. The editable row carries an
        // extra drag grip ahead of the icon, so it needs more leading.
        isReadOnly ? "ml-9" : "ml-[3.625rem]"
      )}
    >
      {videos.map((video) => (
        <VideoBeatNode
          key={video.id}
          video={video}
          lesson={lesson}
          isReadOnly={isReadOnly}
          submitEvent={submitEvent}
          {...videoMenuProps}
        />
      ))}
    </div>
  );
}

function VideoBeatNode({
  video,
  lesson,
  isReadOnly,
  submitEvent,
  ...videoMenuProps
}: {
  video: Video;
  lesson: Lesson;
  isReadOnly: boolean;
  submitEvent: (event: CourseEditorEvent) => void;
} & VideoMenuProps) {
  const { effective: visibility } = useCourseViewVisibility();

  const videoRow = (
    <Link
      to={`/videos/${video.id}/edit`}
      className="block min-w-0 text-muted-foreground truncate hover:text-foreground hover:underline"
    >
      {video.title}
    </Link>
  );

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <VideoContextMenu video={video} lesson={lesson} {...videoMenuProps}>
          {videoRow}
        </VideoContextMenu>
        <VideoWarningIndicator
          warnings={video.warnings}
          isReadOnly={isReadOnly}
          visible={visibility.videoWarnings}
        />
      </div>
      {visibility.beats && (
        <BeatList
          video={{ id: video.id, beats: video.beats ?? [] }}
          submitEvent={submitEvent}
          isReadOnly={isReadOnly}
          showDescriptions={visibility.beatDescriptions}
          showAddButton={visibility.addBeatButton}
          showLearningGoals={visibility.beatLearningGoals}
          sectionLearningGoals={videoMenuProps.section.learningGoals}
          className="mt-0.5"
        />
      )}
    </div>
  );
}
