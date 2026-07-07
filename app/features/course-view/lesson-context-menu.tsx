import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Lesson, Section } from "./course-view-types";
import type { useNavigate } from "react-router";
import {
  ArrowRightLeft,
  FileText,
  FileVideo,
  ListTodo,
  PencilIcon,
  Plus,
  Trash2,
} from "lucide-react";

export function LessonContextMenuContent({
  lesson,
  section,
  isReadOnly,
  compact,
  navigate,
  allSections,
  dispatch,
  submitEvent,
  startEditingTitle,
  startEditingDescription,
}: {
  lesson: Lesson;
  section: Section;
  isReadOnly: boolean;
  compact?: boolean;
  navigate: ReturnType<typeof useNavigate>;
  allSections: { id: string; path: string }[];
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  startEditingTitle: () => void;
  startEditingDescription: () => void;
}) {
  return (
    <ContextMenuContent>
      {compact && lesson.videos.length > 0 && (
        <>
          {lesson.videos.map((video) => (
            <ContextMenuItem
              key={video.id}
              onSelect={() => navigate(`/videos/${video.id}/edit`)}
            >
              <FileVideo className="w-4 h-4" />
              {video.title}
            </ContextMenuItem>
          ))}
          {!isReadOnly && <ContextMenuSeparator />}
        </>
      )}
      {!isReadOnly && (
        <>
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-add-video-to-lesson-id",
                lessonId: lesson.id,
              })
            }
          >
            <Plus className="w-4 h-4" />
            Add Video
          </ContextMenuItem>
          <ContextMenuItem onSelect={startEditingTitle}>
            <PencilIcon className="w-4 h-4" />
            Rename
          </ContextMenuItem>
          {compact && (
            <ContextMenuItem onSelect={startEditingDescription}>
              <FileText className="w-4 h-4" />
              Edit Description
            </ContextMenuItem>
          )}
          {lesson.authoringStatus === "done" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  submitEvent({
                    type: "set-lesson-authoring-status",
                    lessonId: lesson.id,
                    status: "todo",
                  })
                }
              >
                <ListTodo className="w-4 h-4" />
                Mark as TODO
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-insert-lesson",
                sectionId: section.id,
                adjacentLessonId: lesson.id,
                position: "before",
              })
            }
          >
            <Plus className="w-4 h-4" />
            Add Lesson Before
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-insert-lesson",
                sectionId: section.id,
                adjacentLessonId: lesson.id,
                position: "after",
              })
            }
          >
            <Plus className="w-4 h-4" />
            Add Lesson After
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowRightLeft className="w-4 h-4" />
              Move to Section
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {allSections
                .filter((s) => s.id !== section.id)
                .map((targetSection) => (
                  <ContextMenuItem
                    key={targetSection.id}
                    onSelect={() =>
                      submitEvent({
                        type: "move-lesson-to-section",
                        lessonId: lesson.id,
                        targetSectionId: targetSection.id,
                      })
                    }
                  >
                    {targetSection.path}
                  </ContextMenuItem>
                ))}
              {allSections.filter((s) => s.id !== section.id).length === 0 && (
                <ContextMenuItem disabled>No other sections</ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              dispatch({
                type: "set-delete-lesson-id",
                lessonId: lesson.id,
              });
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
