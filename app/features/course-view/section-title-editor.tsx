import { cn } from "@/lib/utils";
import { capitalizeTitle } from "@/utils/capitalize-title";
import type { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export function buildSectionRenameEvent({
  value,
  sectionPath,
  sectionId,
}: {
  value: string;
  sectionPath: string;
  sectionId: string;
}): CourseEditorEvent | null {
  const newTitle = capitalizeTitle(value.trim());
  if (newTitle && newTitle !== sectionPath) {
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
  sectionPath,
  dispatch,
  submitEvent,
  editSectionId,
}: {
  sectionId: string;
  sectionPath: string;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  editSectionId: string | null;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const startEditingTitle = useCallback(() => {
    setTitleValue(sectionPath);
    setEditingTitle(true);
  }, [sectionPath]);

  useEffect(() => {
    if (editSectionId === sectionId && !editingTitle) {
      setTitleValue(sectionPath);
      setEditingTitle(true);
    }
  }, [editSectionId, sectionId, editingTitle, sectionPath]);

  const saveTitle = useCallback(
    (value: string) => {
      setEditingTitle(false);
      dispatch({ type: "set-edit-section-id", sectionId: null });
      const event = buildSectionRenameEvent({
        value,
        sectionPath,
        sectionId,
      });
      if (event) {
        submitEvent(event);
      }
    },
    [sectionId, sectionPath, dispatch, submitEvent]
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
  sectionPath,
  isReadOnly,
  editingTitle,
  titleValue,
  onTitleValueChange,
  onCancel,
  onSave,
  onStartEditing,
  navigateTo,
}: {
  sectionPath: string;
  isReadOnly: boolean;
  editingTitle: boolean;
  titleValue: string;
  onTitleValueChange: (v: string) => void;
  onCancel: () => void;
  onSave: (v: string) => void;
  onStartEditing: () => void;
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
        className={cn(titleClass, "hover:underline")}
        onClick={(e) => e.stopPropagation()}
      >
        {sectionPath}
      </Link>
    );
  }

  return (
    <span
      className={cn(
        titleClass,
        !isReadOnly && "cursor-pointer hover:underline"
      )}
      onClick={() => {
        if (!isReadOnly) onStartEditing();
      }}
    >
      {sectionPath}
    </span>
  );
}
