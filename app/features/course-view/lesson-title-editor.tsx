import { cn } from "@/lib/utils";
import { parseLessonPath, toSlug } from "@/services/lesson-path-service";
import { capitalizeTitle } from "@/utils/capitalize-title";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Lesson } from "./course-view-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export function useLessonTitleEditor({
  lesson,
  isGhost,
  submitEvent,
}: {
  lesson: Lesson;
  isGhost: boolean;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  const parsedPath = !isGhost ? parseLessonPath(lesson.path) : null;
  const currentSlug = parsedPath?.slug ?? lesson.path;
  const pathPrefix = parsedPath
    ? lesson.path.slice(0, lesson.path.length - parsedPath.slug.length)
    : "";

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

  const saveTitle = useCallback(
    (value: string) => {
      setEditingTitle(false);
      if (isGhost) {
        const newTitle = capitalizeTitle(value.trim());
        if (newTitle && newTitle !== (lesson.title || lesson.path)) {
          submitEvent({
            type: "update-lesson-title",
            lessonId: lesson.id,
            title: newTitle,
          });
        }
      } else {
        const newSlug = toSlug(value);
        if (newSlug && newSlug !== currentSlug) {
          submitEvent({
            type: "update-lesson-name",
            lessonId: lesson.id,
            newSlug,
          });
        }
      }
    },
    [isGhost, lesson, currentSlug, submitEvent]
  );

  const startEditingTitle = useCallback(() => {
    setTitleValue(isGhost ? lesson.title || lesson.path : currentSlug);
    setEditingTitle(true);
  }, [isGhost, lesson, currentSlug]);

  return {
    editingTitle,
    titleValue,
    setTitleValue,
    setEditingTitle,
    saveTitle,
    startEditingTitle,
    pathPrefix,
  };
}

export function LessonTitleEditor({
  lesson,
  isGhost,
  isReadOnly,
  showGhostStyle,
  editingTitle,
  titleValue,
  pathPrefix,
  onTitleValueChange,
  onCancel,
  onSave,
  onStartEditing,
  navigateTo,
}: {
  lesson: Lesson;
  isGhost: boolean;
  isReadOnly: boolean;
  showGhostStyle: boolean;
  editingTitle: boolean;
  titleValue: string;
  pathPrefix: string;
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
  const currentTitleDisplay = isGhost
    ? lesson.title || lesson.path
    : lesson.path;

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
        {!isGhost && pathPrefix && (
          <span className="text-sm font-mono text-muted-foreground shrink-0">
            {pathPrefix}
          </span>
        )}
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
        {currentTitleDisplay}
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
      {currentTitleDisplay}
    </span>
  );
}
