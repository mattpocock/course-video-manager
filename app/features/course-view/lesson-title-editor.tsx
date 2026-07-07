import { cn } from "@/lib/utils";
import { capitalizeTitle } from "@/utils/capitalize-title";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Lesson } from "./course-view-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export function useLessonTitleEditor({
  lesson,
  submitEvent,
}: {
  lesson: Lesson;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  const currentTitle = lesson.title || lesson.path;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const saveTitle = useCallback(
    (value: string) => {
      setEditingTitle(false);
      const newTitle = capitalizeTitle(value.trim());
      if (newTitle && newTitle !== currentTitle) {
        submitEvent({
          type: "update-lesson-title",
          lessonId: lesson.id,
          title: newTitle,
        });
      }
    },
    [lesson.id, currentTitle, submitEvent]
  );

  const startEditingTitle = useCallback(() => {
    setTitleValue(currentTitle);
    setEditingTitle(true);
  }, [currentTitle]);

  return {
    editingTitle,
    titleValue,
    setTitleValue,
    setEditingTitle,
    saveTitle,
    startEditingTitle,
  };
}

export function LessonTitleEditor({
  lesson,
  isReadOnly,
  showGhostStyle,
  editingTitle,
  titleValue,
  onTitleValueChange,
  onCancel,
  onSave,
  onStartEditing,
  navigateTo,
}: {
  lesson: Lesson;
  isReadOnly: boolean;
  showGhostStyle: boolean;
  editingTitle: boolean;
  titleValue: string;
  onTitleValueChange: (v: string) => void;
  onCancel: () => void;
  onSave: (v: string) => void;
  onStartEditing: () => void;
  /**
   * When set, the title's display state becomes a navigation link to the
   * Section Workbench instead of a click-to-rename trigger. Renaming then
   * happens only via the context-menu "Rename" (which still flips to the
   * inline editor here). Editing always wins over the link.
   */
  navigateTo?: string;
}) {
  const displayTitle = lesson.title || lesson.path;

  const handledRef = useRef(false);

  useEffect(() => {
    if (editingTitle) {
      handledRef.current = false;
    }
  }, [editingTitle]);

  if (!isReadOnly && editingTitle) {
    return (
      <div
        className="flex items-center gap-1 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="text-sm font-normal bg-transparent border-b border-foreground outline-none min-w-0"
          size={Math.max(titleValue.length, 1)}
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
          "text-sm font-normal hover:underline",
          !showGhostStyle && "text-foreground/90",
          showGhostStyle && "text-muted-foreground/70 italic"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {displayTitle}
      </Link>
    );
  }

  return (
    <span
      className={cn(
        "text-sm font-normal",
        !showGhostStyle && "text-foreground/90",
        showGhostStyle && "text-muted-foreground/70 italic",
        !isReadOnly && "cursor-pointer hover:underline"
      )}
      onClick={() => {
        if (!isReadOnly) onStartEditing();
      }}
    >
      {displayTitle}
    </span>
  );
}
