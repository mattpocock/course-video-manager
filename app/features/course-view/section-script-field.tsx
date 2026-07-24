"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useFetcher } from "react-router";
import { Maximize2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 700;

/**
 * One video's teleprompter script as a block in the section-level Scripts
 * document ({@link SectionScriptsView}): a title, then an auto-growing textarea
 * that reads as flowing prose (no inner scrollbar) rather than a boxed editor.
 *
 * Reads are seeded from the section loader (`initialScript`) — no per-field
 * fetch, so opening the tab doesn't fan out one heavy writer-context request per
 * video. Writes go per-video through `/api/videos/:videoId/script` (silent
 * autosave, debounced + on blur); the loader re-seeds the field on revalidation
 * when it isn't focused. The "Open in writer" button hands off to the full
 * {@link ScriptWriterModal} (Monaco + preview) for heavier editing; we
 * deliberately don't stack `WritableField`s here because they'd all share the
 * single `?writer=video-script` URL slot and open at once.
 */
export function SectionScriptField({
  videoId,
  title,
  initialScript,
  readOnly,
  onOpenWriter,
}: {
  videoId: string;
  title: string;
  initialScript: string;
  readOnly: boolean;
  onOpenWriter: () => void;
}) {
  const saveFetcher = useFetcher();

  // Local draft so typing stays smooth; re-seed from the loader value only when
  // the user isn't editing this field (mirrors WritableField's approach), so a
  // revalidation can't clobber in-progress edits.
  const [draft, setDraft] = useState(initialScript);
  const focusedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focusedRef.current) setDraft(initialScript);
  }, [initialScript]);

  const persistScript = useCallback(
    (value: string) => {
      saveFetcher.submit(
        { intent: "updateScript", script: value },
        { method: "post", action: `/api/videos/${videoId}/script` }
      );
    },
    [saveFetcher, videoId]
  );

  const scheduleSave = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => persistScript(value),
        SAVE_DEBOUNCE_MS
      );
    },
    [persistScript]
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  // Auto-grow: keep the textarea tall enough to show all its text.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <div className="group">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            onClick={onOpenWriter}
            title="Open in writer"
          >
            <Maximize2Icon className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        readOnly={readOnly}
        placeholder="Write the teleprompter script for this video…"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (draft !== initialScript) persistScript(draft);
        }}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          if (!readOnly) scheduleSave(value);
        }}
        className={cn(
          "w-full resize-none bg-transparent text-sm leading-relaxed text-foreground",
          "placeholder:text-muted-foreground focus:outline-none",
          "border-l-2 border-transparent focus:border-primary/50 pl-3 -ml-3",
          readOnly && "cursor-default"
        )}
        rows={2}
      />
    </div>
  );
}
