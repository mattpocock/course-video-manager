"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Button } from "@/components/ui/button";
import { MarkdownMonacoEditor } from "@/components/markdown-monaco-editor";
import { cn } from "@/lib/utils";
import { PencilIcon, EyeIcon, Maximize2Icon } from "lucide-react";
import type { OnMount } from "@monaco-editor/react";
import type { WriterContext } from "./writer-engine";
import type { Mode, WriterView } from "./types";
import type { WriterFieldId } from "./writer-engine-utils";
import { FIELD_MODES } from "./writer-engine-utils";
import { WriterModal } from "./writer-modal";
import {
  WRITER_URL_UPDATE,
  applyWriterUrlState,
  readWriterUrlState,
  type WriterUrlState,
} from "./writer-url-state";

interface WritableFieldPropsBase {
  videoId: string;
  fieldId: WriterFieldId;
  value: string;
  /** Persist an inline edit made directly in the field's Monaco editor. */
  onChange?: (newValue: string) => void;
  /** Persist the value applied from the fullscreen writer modal. */
  onApply: (newValue: string) => void;
  context: WriterContext;
  modes?: Mode[];
  label?: string;
  placeholder?: string;
  className?: string;
  /** When set, the modal's Repo Files tab shows an "add from clipboard" button. */
  onAddFileFromClipboard?: () => void;
  /** Other fields on the same page, offered as toggleable AI context. */
  pageFields?: Array<{ id: string; label: string; value: string }>;
}

export type WritableFieldProps = WritableFieldPropsBase &
  (
    | {
        /** Fill parent container instead of using a fixed height. Removes own
         *  border/rounding so the parent's chrome frames the editor. */
        fill: true;
        height?: never;
      }
    | {
        fill?: false | undefined;
        /** Height of the inline editor/preview box in pixels. */
        height?: number;
      }
  );

export function WritableField({
  videoId,
  fieldId,
  value,
  onChange,
  onApply,
  context,
  modes,
  label,
  placeholder,
  className,
  height = 280,
  fill,
  onAddFileFromClipboard,
  pageFields,
}: WritableFieldProps) {
  const resolvedModes = modes ?? FIELD_MODES[fieldId] ?? [];

  const [searchParams, setSearchParams] = useSearchParams();

  // The open writer lives in the URL so a reload restores it.
  const writerState = readWriterUrlState(searchParams, fieldId);
  const isOpen = writerState !== null;
  const view = writerState?.view ?? "writer";
  const ctxTab = writerState?.ctxTab;

  // Inline editor state: a local draft drives Monaco so persisting through the
  // host (which round-trips the value back down) never yanks the cursor.
  // Default to preview: the rendered markdown is a lightweight, stable first
  // paint, so the heavyweight Monaco editor only loads once the user opts into
  // editing — avoiding the load-time layout shift.
  const [preview, setPreview] = useState(true);
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);

  // Re-seed the draft from the canonical value only when the user isn't
  // actively typing (e.g. after a modal Apply or an external revalidation).
  useEffect(() => {
    if (!isFocusedRef.current) setDraft(value);
  }, [value]);

  const handleInlineChange = useCallback(
    (next: string) => {
      setDraft(next);
      onChange?.(next);
    },
    [onChange]
  );

  const handleEditorMount = useCallback<OnMount>((editor) => {
    editor.onDidFocusEditorText(() => {
      isFocusedRef.current = true;
    });
    editor.onDidBlurEditorText(() => {
      isFocusedRef.current = false;
    });
  }, []);

  const updateWriterUrl = useCallback(
    (next: WriterUrlState) => {
      setSearchParams(
        (prev) => applyWriterUrlState(prev, fieldId, next),
        WRITER_URL_UPDATE
      );
    },
    [setSearchParams, fieldId]
  );

  const setOpen = useCallback(
    (open: boolean) => {
      // Opening starts on the writer with no context tab selected, so a fresh
      // open never inherits the sub-view another field was left on.
      updateWriterUrl(open ? { view: "writer", ctxTab: undefined } : null);
    },
    [updateWriterUrl]
  );

  const handleViewChange = useCallback(
    (v: WriterView) => {
      updateWriterUrl({ view: v, ctxTab });
    },
    [updateWriterUrl, ctxTab]
  );

  const handleCtxTabChange = useCallback(
    (tab: string) => {
      updateWriterUrl({ view, ctxTab: tab });
    },
    [updateWriterUrl, view]
  );

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden bg-background",
          fill ? "flex flex-col flex-1 min-h-0" : "rounded-md border",
          className
        )}
      >
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 shadow-sm"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? (
              <>
                <PencilIcon className="mr-1 size-3.5" /> Edit
              </>
            ) : (
              <>
                <EyeIcon className="mr-1 size-3.5" /> Preview
              </>
            )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 shadow-sm"
            onClick={() => setOpen(true)}
          >
            <Maximize2Icon className="mr-1 size-3.5" /> Open in writer
          </Button>
        </div>
        <div
          className={fill ? "flex-1 min-h-0" : undefined}
          style={fill ? undefined : { height }}
        >
          {preview ? (
            <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted h-full overflow-y-auto p-4">
              <div className="max-w-[75ch]">
                {draft ? (
                  <AIResponse imageBasePath={context.fullPath}>
                    {draft}
                  </AIResponse>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {placeholder ?? "Nothing written yet."}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <MarkdownMonacoEditor
              value={draft}
              onChange={handleInlineChange}
              onMount={handleEditorMount}
              options={{ padding: { top: 12, bottom: 12 } }}
              fallback={
                <div className="p-4 text-sm text-muted-foreground">
                  Loading editor…
                </div>
              }
            />
          )}
        </div>
      </div>

      <WriterModal
        open={isOpen}
        onOpenChange={setOpen}
        videoId={videoId}
        fieldId={fieldId}
        modes={resolvedModes}
        value={value}
        context={context}
        label={label}
        onApply={onApply}
        onAddFileFromClipboard={onAddFileFromClipboard}
        pageFields={pageFields}
        view={view}
        onViewChange={handleViewChange}
        ctxTab={ctxTab}
        onCtxTabChange={handleCtxTabChange}
      />
    </>
  );
}
