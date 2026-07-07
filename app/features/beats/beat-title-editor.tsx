import { cn } from "@/lib/utils";
import { useState } from "react";

/**
 * Inline-editable Beat title. Click the title to edit; Enter or blur saves,
 * Escape cancels. Mirrors the lesson/section inline-edit pattern. When the
 * title is empty it shows the supplied `placeholder` (the kind label) in
 * italics.
 */
export function BeatTitleEditor({
  title,
  placeholder,
  isReadOnly,
  onSave,
}: {
  title: string;
  placeholder: string;
  isReadOnly: boolean;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const start = () => {
    if (isReadOnly) return;
    setValue(title);
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    const next = value.trim();
    if (next !== title.trim()) onSave(next);
  };

  if (editing && !isReadOnly) {
    return (
      <input
        className="bg-transparent border-b border-foreground outline-none min-w-0 text-xs"
        size={Math.max(value.length, placeholder.length, 1)}
        value={value}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") save();
        }}
        onBlur={save}
      />
    );
  }

  return (
    <span
      className={cn(
        "truncate",
        !title.trim() && "italic text-muted-foreground",
        !isReadOnly && "cursor-text hover:underline"
      )}
      onClick={(e) => {
        e.stopPropagation();
        start();
      }}
    >
      {title.trim() || placeholder}
    </span>
  );
}
