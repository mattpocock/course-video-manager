import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Inline editor for a Clip Mockup's spoken line. Click the line to edit;
 * Enter or blur commits, Escape cancels, Shift+Enter inserts a newline.
 *
 * Mirrors {@link BeatDescriptionEditor} with one difference that matters: a
 * Clip Mockup's line is NEVER EMPTY — a Clip Mockup with no words is not a
 * thing — so an emptied field cancels back to the old line rather than saving
 * one. There is no "+ add" affordance for the same reason.
 *
 * Committing costs a Gemini call, so `isSaving` locks the field while the line
 * is being re-voiced instead of letting a second edit race the first.
 */
export function ClipMockupLineEditor({
  line,
  isSaving,
  onSave,
  className,
}: {
  line: string;
  isSaving: boolean;
  onSave: (line: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: keep the textarea exactly as tall as its content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = value.trim();
    // An empty line is a cancel, not a save.
    if (next !== "" && next !== line.trim()) onSave(next);
  };

  if (editing && !isSaving) {
    return (
      <textarea
        ref={textareaRef}
        className={cn(
          "w-full resize-none bg-transparent border-l-2 border-foreground pl-2 text-xs outline-none",
          className
        )}
        rows={1}
        value={value}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <p
      className={cn(
        "whitespace-pre-line border-l-2 border-muted-foreground/20 pl-2 text-xs",
        isSaving
          ? "text-muted-foreground/60"
          : "cursor-text hover:border-muted-foreground/60",
        className
      )}
      onClick={(e) => {
        if (isSaving) return;
        e.stopPropagation();
        setValue(line);
        setEditing(true);
      }}
    >
      {line}
    </p>
  );
}
