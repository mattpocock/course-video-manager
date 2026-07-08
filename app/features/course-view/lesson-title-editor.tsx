import { cn } from "@/lib/utils";
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
      const newTitle = value.trim();
      if (newTitle && newTitle !== currentTitle) {
        submitEvent({
          type: "update-lesson-title",
          lessonId: lesson.id,
          title: newTitle,
        });
      }
    },
    [lesson, currentTitle, submitEvent]
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
  editingTitle: boolean;
  titleValue: string;
  onTitleValueChange: (v: string) => void;
  onCancel: () => void;
  onSave: (v: string) => void;
  onStartEditing: () => void;
  navigateTo?: string;
}) {
  const currentTitleDisplay = lesson.title || lesson.path;

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
          "text-foreground/90"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {currentTitleDisplay}
      </Link>
    );
  }

  return (
    <span
      className={cn(
        "text-sm font-normal",
        "text-foreground/90",
        !isReadOnly && "cursor-pointer hover:underline"
      )}
      onClick={() => {
        if (!isReadOnly) onStartEditing();
      }}
    >
      {currentTitleDisplay}
    </span>
  );
}
