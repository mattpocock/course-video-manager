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
import {
  ArrowRightLeft,
  BookOpen,
  Eye,
  EyeOff,
  Ghost,
  ListTodo,
  PencilIcon,
  Plus,
  Trash2,
} from "lucide-react";

export function LessonContextMenuContent({
  lesson,
  section,
  isGhost,
  isReadOnly,
  isGhostCourse,
  compact,
  videosExpanded,
  onToggleVideos,
  allSections,
  dispatch,
  submitEvent,
  startEditingTitle,
}: {
  lesson: Lesson;
  section: Section;
  isGhost: boolean;
  isReadOnly: boolean;
  isGhostCourse?: boolean;
  compact?: boolean;
  videosExpanded: boolean;
  onToggleVideos: () => void;
  allSections: { id: string; path: string }[];
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  startEditingTitle: () => void;
}) {
  return (
    <ContextMenuContent>
      {compact && lesson.videos.length > 0 && (
        <>
          <ContextMenuItem onSelect={onToggleVideos}>
            {videosExpanded ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            {videosExpanded ? "Hide Videos" : "Show Videos"}
          </ContextMenuItem>
          {!isReadOnly && <ContextMenuSeparator />}
        </>
      )}
      {!isReadOnly && (
        <>
          {isGhost ? (
            <>
              <ContextMenuItem
                onSelect={() => {
                  if (isGhostCourse) {
                    dispatch({
                      type: "set-create-on-disk-lesson-id",
                      lessonId: lesson.id,
                    });
                  } else {
                    submitEvent({
                      type: "create-on-disk",
                      lessonId: lesson.id,
                    });
                  }
                }}
              >
                <BookOpen className="w-4 h-4" />
                Create on Disk
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={startEditingTitle}>
                <PencilIcon className="w-4 h-4" />
                Rename
              </ContextMenuItem>
            </>
          ) : (
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
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  dispatch({
                    type: "set-convert-to-ghost-lesson-id",
                    lessonId: lesson.id,
                  })
                }
              >
                <Ghost className="w-4 h-4" />
                Convert to Ghost
              </ContextMenuItem>
              {lesson.authoringStatus === "done" && (
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
              )}
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
              if (isGhost) {
                submitEvent({
                  type: "delete-lesson",
                  lessonId: lesson.id,
                });
              } else {
                dispatch({
                  type: "set-delete-lesson-id",
                  lessonId: lesson.id,
                });
              }
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
