"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkdownMonacoEditor } from "@/components/markdown-monaco-editor";
import { cn } from "@/lib/utils";
import { PencilIcon, EyeIcon, Maximize2Icon } from "lucide-react";
import type { OnMount } from "@monaco-editor/react";
import { WriterEngine, type WriterContext } from "./writer-engine";
import type { Mode } from "./types";
import type { WriterFieldId } from "./writer-engine-utils";
import {
  FIELD_LABELS,
  FIELD_MODES,
  saveFieldMessages,
  loadFieldMessages,
} from "./writer-engine-utils";

export interface WritableFieldProps {
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
  /** Height of the inline editor/preview box in pixels. */
  height?: number;
  /** When set, the modal's Repo Files tab shows an "add from clipboard" button. */
  onAddFileFromClipboard?: () => void;
  /** Other fields on the same page, offered as toggleable AI context. */
  pageFields?: Array<{ id: string; label: string; value: string }>;
}

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
  onAddFileFromClipboard,
  pageFields,
}: WritableFieldProps) {
  const resolvedModes = modes ?? FIELD_MODES[fieldId] ?? [];
  const resolvedLabel = label ?? FIELD_LABELS[fieldId] ?? fieldId;

  const [searchParams, setSearchParams] = useSearchParams();
  const isOpen = searchParams.get("writer") === fieldId;

  const view =
    (searchParams.get("writerView") as
      | "writer"
      | "context"
      | "settings"
      | null) ?? "writer";
  const ctxTab = searchParams.get("writerTab") ?? undefined;

  const workingValueRef = useRef(value);
  const snapshotMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

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

  const setOpen = useCallback(
    (open: boolean) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (open) {
            next.set("writer", fieldId);
          } else {
            next.delete("writer");
            next.delete("writerView");
            next.delete("writerTab");
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, fieldId]
  );

  const handleViewChange = useCallback(
    (v: "writer" | "context" | "settings") => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === "writer") {
            next.delete("writerView");
          } else {
            next.set("writerView", v);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleCtxTabChange = useCallback(
    (tab: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("writerTab", tab);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleOpen = useCallback(() => {
    workingValueRef.current = value;
    setIsDirty(false);
    setShowConfirmClose(false);
    const snap = new Map<string, unknown[]>();
    for (const m of resolvedModes) {
      snap.set(m, loadFieldMessages(videoId, fieldId, m));
    }
    snapshotMessagesRef.current = snap;
    setOpen(true);
  }, [value, resolvedModes, videoId, fieldId, setOpen]);

  const handleApply = useCallback(
    (finalValue: string) => {
      onApply(finalValue);
      workingValueRef.current = finalValue;
      setIsDirty(false);
      setOpen(false);
    },
    [onApply, setOpen]
  );

  const handleCancel = useCallback(() => {
    for (const [m, msgs] of snapshotMessagesRef.current) {
      saveFieldMessages(videoId, fieldId, m as Mode, msgs);
    }
    workingValueRef.current = value;
    setIsDirty(false);
    setShowConfirmClose(false);
    setOpen(false);
  }, [videoId, fieldId, value, setOpen]);

  const handleRequestClose = useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      handleCancel();
    }
  }, [isDirty, handleCancel]);

  const handleDocumentChange = useCallback(
    (doc: string) => {
      workingValueRef.current = doc;
      setIsDirty(doc !== value);
    },
    [value]
  );

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-md border bg-background",
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
            onClick={handleOpen}
          >
            <Maximize2Icon className="mr-1 size-3.5" /> Open in writer
          </Button>
        </div>
        <div style={{ height }}>
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

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleRequestClose();
        }}
      >
        <DialogContent
          className="flex h-[96vh] w-[97vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{resolvedLabel}</DialogTitle>
          <div className="flex items-center px-4 py-2 border-b">
            <h2 className="text-sm font-semibold">{resolvedLabel}</h2>
          </div>
          <div className="relative flex-1 overflow-hidden">
            {isOpen && (
              <WriterEngine
                videoId={videoId}
                fieldId={fieldId}
                modes={resolvedModes}
                initialDocument={value}
                layout="modal"
                context={context}
                onDocumentChange={handleDocumentChange}
                view={view}
                onViewChange={handleViewChange}
                ctxTab={ctxTab}
                onCtxTabChange={handleCtxTabChange}
                onCancel={handleRequestClose}
                onApply={handleApply}
                onAddFileFromClipboard={onAddFileFromClipboard}
                pageFields={pageFields}
              />
            )}

            {/* Unsaved-changes confirmation */}
            {showConfirmClose && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                <div className="max-w-sm rounded-lg border bg-background p-6 shadow-lg">
                  <h3 className="text-base font-semibold">Unsaved changes</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    You have unsaved edits. Discard them?
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowConfirmClose(false)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCancel}
                    >
                      Discard
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
