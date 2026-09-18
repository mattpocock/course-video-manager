import { useState } from "react";
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
  // Two components rather than one branchy one: the compact reading has no
  // draft to hold, and splitting keeps the editor's hooks out of a branch the
  // view-mode toggle can flip underneath them.
  if (compact) {
    if (!description) return null;
    return (
      <div className="ml-5 text-xs text-muted-foreground whitespace-pre-line max-w-[65ch]">
        {description}
      </div>
    );
  }

  return (
    <EditableLessonDescription
      description={description}
      isReadOnly={isReadOnly}
      onSave={onSave}
    />
  );
}

function EditableLessonDescription({
  description,
  isReadOnly,
  onSave,
}: {
  description: string;
  isReadOnly: boolean;
  onSave: (value: string) => void;
}) {
  // `null` means "not editing". One value instead of an `editing` flag beside a
  // mirrored `value`, so there is no draft left over from a previous edit for
  // the next one to open on — every way in seeds it explicitly.
  const [draft, setDraft] = useState<string | null>(null);

  const save = (value: string) => {
    setDraft(null);
    onSave(value);
  };

  if (!isReadOnly && draft !== null) {
    return (
      <div className="ml-5 mt-1 max-w-[65ch]">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What should this lesson teach?"
          className="text-sm min-h-[60px]"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(draft);
          }}
          onBlur={() => save(draft)}
        />
      </div>
    );
  }

  if (description) {
    return (
      <div
        className={cn(
          "ml-5 text-xs text-muted-foreground mt-1 whitespace-pre-line max-w-[65ch]",
          !isReadOnly && "cursor-pointer hover:text-foreground/70"
        )}
        onClick={() => {
          if (isReadOnly) return;
          setDraft(description);
        }}
      >
        {description}
      </div>
    );
  }

  if (isReadOnly) return null;

  return (
    <div className="ml-5">
      <button
        className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        onClick={() => setDraft("")}
      >
        + Add description
      </button>
    </div>
  );
}
