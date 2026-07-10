import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Inline, auto-growing Beat Description editor — the single component used
 * for the free-text planning note on both the Section Workbench and the
 * editor's Beats tab. Click the note to edit; Enter or blur commits, Escape
 * cancels (Shift+Enter inserts a newline so notes can span lines). When the
 * description is empty it shows a muted "+ Add note" affordance instead.
 *
 * Mirrors {@link BeatTitleEditor}, but multi-line. Read-only surfaces (the
 * course view, a capture in progress) render the plain text — or nothing when
 * empty — by passing `isReadOnly`.
 */
export function BeatDescriptionEditor({
  description,
  isReadOnly,
  onSave,
  className,
}: {
  description: string;
  isReadOnly: boolean;
  onSave: (description: string) => void;
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

  const start = () => {
    if (isReadOnly) return;
    setValue(description);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next !== description.trim()) onSave(next);
  };

  if (editing && !isReadOnly) {
    return (
      <textarea
        ref={textareaRef}
        className={cn(
          "w-full max-w-[80ch] resize-none bg-transparent border-l-2 border-muted-foreground/40 pl-2 text-xs text-muted-foreground outline-none focus:border-foreground",
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
          // Enter commits; Shift+Enter inserts a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    );
  }

  const trimmed = description.trim();

  if (!trimmed) {
    if (isReadOnly) return null;
    return (
      <button
        type="button"
        className={cn(
          "text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors",
          className
        )}
        onClick={(e) => {
          e.stopPropagation();
          start();
        }}
      >
        + Add note
      </button>
    );
  }

  return (
    <p
      className={cn(
        "whitespace-pre-line max-w-[80ch] border-l-2 border-muted-foreground/20 pl-2 text-xs text-muted-foreground",
        !isReadOnly && "cursor-text hover:text-foreground/70",
        className
      )}
      onClick={(e) => {
        if (isReadOnly) return;
        e.stopPropagation();
        start();
      }}
    >
      {trimmed}
    </p>
  );
}
