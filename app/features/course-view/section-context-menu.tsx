import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  PencilIcon,
  Plus,
  Trash2,
} from "lucide-react";
import type { Lesson } from "./course-view-types";
import { computeSectionSwap } from "./section-grid-utils";

export function SectionContextMenuItems({
  section,
  lessons,
  allSectionIds,
  isReadOnly,
  isGhostSection,
  dispatch,
  submitEvent,
}: {
  section: { id: string; path: string; description?: string | null };
  lessons: Lesson[];
  allSectionIds: string[];
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
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!computeSectionSwap(allSectionIds, section.id, "up")}
            onSelect={() => {
              const newOrder = computeSectionSwap(
                allSectionIds,
                section.id,
                "up"
              );
              if (newOrder)
                submitEvent({ type: "reorder-sections", sectionIds: newOrder });
            }}
          >
            <ArrowUp className="w-4 h-4" />
            Move Up
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!computeSectionSwap(allSectionIds, section.id, "down")}
            onSelect={() => {
              const newOrder = computeSectionSwap(
                allSectionIds,
                section.id,
                "down"
              );
              if (newOrder)
                submitEvent({ type: "reorder-sections", sectionIds: newOrder });
            }}
          >
            <ArrowDown className="w-4 h-4" />
            Move Down
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
            <Trash2 className="w-4 h-4" />
            Delete Section
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}
