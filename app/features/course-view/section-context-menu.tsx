import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { Archive, ClipboardCopy, PencilIcon, Plus } from "lucide-react";
import type { Lesson } from "./course-view-types";

export function SectionContextMenuItems({
  section,
  lessons,
  isReadOnly,
  isGhostSection,
  dispatch,
  submitEvent,
}: {
  section: { id: string; path: string; description?: string | null };
  lessons: Lesson[];
  isReadOnly: boolean;
  isGhostSection: boolean;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  return (
    <ContextMenuContent>
      {!isReadOnly && (
        <>
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-add-lesson-section-id",
                sectionId: section.id,
              })
            }
          >
            <Plus className="w-4 h-4" />
            Add Lesson
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-edit-section-id",
                sectionId: section.id,
              })
            }
          >
            <PencilIcon className="w-4 h-4" />
            Rename
          </ContextMenuItem>
        </>
      )}
      {lessons.length > 0 && (
        <ContextMenuItem
          onSelect={() =>
            dispatch({
              type: "open-copy-section-transcript",
              sectionPath: section.path,
              sectionDescription: section.description ?? undefined,
              lessons,
            })
          }
        >
          <ClipboardCopy className="w-4 h-4" />
          Copy Section Transcript
        </ContextMenuItem>
      )}
      {!isReadOnly && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-insert-section",
                adjacentSectionId: section.id,
                position: "before",
              })
            }
          >
            <Plus className="w-4 h-4" />
            Add Section Before
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              dispatch({
                type: "set-insert-section",
                adjacentSectionId: section.id,
                position: "after",
              })
            }
          >
            <Plus className="w-4 h-4" />
            Add Section After
          </ContextMenuItem>
        </>
      )}
      {!isReadOnly && isGhostSection && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              if (lessons.length === 0) {
                submitEvent({
                  type: "archive-section",
                  sectionId: section.id,
                });
              } else {
                dispatch({
                  type: "set-archive-section-id",
                  sectionId: section.id,
                });
              }
            }}
          >
            <Archive className="w-4 h-4" />
            Archive Section
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}
