import { cn } from "@/lib/utils";
import { capitalizeTitle } from "@/utils/capitalize-title";
import type { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

/**
 * Pure helper: given an edit value, returns the rename event payload
 * to submit, or null if no change is needed.
 */
export function buildSectionRenameEvent({
  value,
  currentTitle,
  sectionId,
}: {
  value: string;
  currentTitle: string;
  sectionId: string;
}): CourseEditorEvent | null {
  const newTitle = capitalizeTitle(value.trim());
  if (newTitle && newTitle !== currentTitle) {
    return {
      type: "update-section-name",
      sectionId,
      title: newTitle,
    };
  }
  return null;
}

export function useSectionTitleEditor({
  sectionId,
  sectionTitle,
  dispatch,
  submitEvent,
  editSectionId,
}: {
  sectionId: string;
  sectionTitle: string;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  editSectionId: string | null;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const startEditingTitle = useCallback(() => {
    setTitleValue(sectionTitle);
    setEditingTitle(true);
  }, [sectionTitle]);

  useEffect(() => {
    if (editSectionId === sectionId && !editingTitle) {
      setTitleValue(sectionTitle);
      setEditingTitle(true);
    }
  }, [editSectionId, sectionId, editingTitle, sectionTitle]);

  const saveTitle = useCallback(
    (value: string) => {
      setEditingTitle(false);
      dispatch({ type: "set-edit-section-id", sectionId: null });
      const event = buildSectionRenameEvent({
        value,
        currentTitle: sectionTitle,
        sectionId,
      });
      if (event) {
        submitEvent(event);
      }
    },
    [sectionId, sectionTitle, dispatch, submitEvent]
  );

  const cancelEditing = useCallback(() => {
    setEditingTitle(false);
    dispatch({ type: "set-edit-section-id", sectionId: null });
  }, [dispatch]);

  return {
    editingTitle,
    titleValue,
    setTitleValue,
    saveTitle,
    cancelEditing,
    startEditingTitle,
  };
}

export function SectionTitleEditor({
  sectionTitle,
  showGhostStyle,
  isReadOnly,
  editingTitle,
  titleValue,
  onTitleValueChange,
  onCancel,
  onSave,
  onStartEditing,
  navigateTo,
}: {
  sectionTitle: string;
  showGhostStyle: boolean;
  isReadOnly: boolean;
  editingTitle: boolean;
  titleValue: string;
  onTitleValueChange: (v: string) => void;
  onCancel: () => void;
  onSave: (v: string) => void;
  onStartEditing: () => void;
  /**
   * When set, the section header's display state becomes a navigation link to
   * the Section Workbench instead of a click-to-rename trigger. Renaming then
   * happens only via the context-menu "Rename" (which flips to the inline
   * editor through the `editSectionId` effect). Editing always wins.
   */
  navigateTo?: string;
}) {
  const handledRef = useRef(false);
  const titleClass = "text-base font-semibold";

  if (!isReadOnly && editingTitle) {
    return (
      <div
        className="flex items-center gap-1 flex-1 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className={cn(
            "bg-transparent border-b border-foreground outline-none flex-1 min-w-0",
            titleClass
          )}
          value={titleValue}
          autoFocus
          onChange={(e) => onTitleValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              handledRef.current = true;
              onCancel();
            }
            if (e.key === "Enter") {
              handledRef.current = true;
              onSave(titleValue);
            }
          }}
          onFocus={(e) => {
            handledRef.current = false;
            e.target.select();
          }}
          onBlur={() => {
            if (!handledRef.current) {
              onSave(titleValue);
            }
          }}
        />
      </div>
    );
  }

  if (navigateTo) {
    return (
      <Link
        to={navigateTo}
        className={cn(
          titleClass,
          "hover:underline",
          showGhostStyle && "text-muted-foreground/70 italic"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {sectionTitle}
      </Link>
    );
  }

  return (
    <span
      className={cn(
        titleClass,
        showGhostStyle && "text-muted-foreground/70 italic",
        !isReadOnly && "cursor-pointer hover:underline"
      )}
      onClick={() => {
        if (!isReadOnly) onStartEditing();
      }}
    >
      {sectionTitle}
    </span>
  );
}
