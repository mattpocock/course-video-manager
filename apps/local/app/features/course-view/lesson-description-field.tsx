import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * A Lesson's free-text description as it appears on the course view, in both
 * view modes. Gated by the `lessonDescriptions` display setting at the call
 * site (see course-view-visibility.tsx) — `compact` decides how it reads, not
 * whether it renders at all.
 *
 * Expanded is the authoring surface: click the text (or the "+ Add
 * description" placeholder) to edit it in place. Compact is a density mode, so
 * it shows the description read-only and skips the placeholder entirely — a
 * lesson with nothing written costs no height, and the way in is the row's
 * context menu ("Edit Description", lesson-context-menu.tsx).
 */
export function LessonDescriptionField({
  description,
  isReadOnly,
  compact,
  onSave,
}: {
  description: string;
  isReadOnly: boolean;
  compact: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const save = (next: string) => {
    setEditing(false);
    onSave(next);
  };

  if (compact) {
    if (!description) return null;
    return (
      <div className="ml-5 text-xs text-muted-foreground whitespace-pre-line max-w-[65ch]">
        {description}
      </div>
    );
  }

  return (
    <div className="ml-5">
      {!isReadOnly && editing ? (
        <div className="mt-1 max-w-[65ch]">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="What should this lesson teach?"
            className="text-sm min-h-[60px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setValue(description);
                setEditing(false);
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                save(value);
              }
            }}
            onBlur={() => save(value)}
          />
        </div>
      ) : description ? (
        <div
          className={cn(
            "text-xs text-muted-foreground mt-1 whitespace-pre-line max-w-[65ch]",
            !isReadOnly && "cursor-pointer hover:text-foreground/70"
          )}
          onClick={() => {
            if (isReadOnly) return;
            setValue(description);
            setEditing(true);
          }}
        >
          {description}
        </div>
      ) : !isReadOnly ? (
        <button
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          onClick={() => {
            setValue("");
            setEditing(true);
          }}
        >
          + Add description
        </button>
      ) : null}
    </div>
  );
}
