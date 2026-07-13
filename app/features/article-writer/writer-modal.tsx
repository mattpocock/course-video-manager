"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WriterEngine, type WriterContext } from "./writer-engine";
import type { Mode } from "./types";
import type { WriterFieldId } from "./writer-engine-utils";
import {
  FIELD_LABELS,
  saveFieldMessages,
  loadFieldMessages,
} from "./writer-engine-utils";

export interface WriterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  fieldId: WriterFieldId;
  modes: Mode[];
  /** Current persisted value; seeds the writer document. */
  value: string;
  /**
   * The writer context. `null` renders a loading state so callers can open the
   * modal before the (possibly on-demand fetched) context has resolved.
   */
  context: WriterContext | null;
  label?: string;
  /** Receives the final (image-uploaded) document to persist. */
  onApply: (finalValue: string) => void;
  /** When set, the modal's Repo Files tab shows an "add from clipboard" button. */
  onAddFileFromClipboard?: () => void;
  /** Other fields on the same page, offered as toggleable AI context. */
  pageFields?: Array<{ id: string; label: string; value: string }>;
  // Optional controlled sub-view. When omitted the modal manages it internally;
  // WritableField drives these through URL search params so a reload restores
  // the open writer's tab.
  view?: "writer" | "context" | "settings";
  onViewChange?: (view: "writer" | "context" | "settings") => void;
  ctxTab?: string;
  onCtxTabChange?: (tab: string) => void;
}

/**
 * The fullscreen AI Writer, wrapped in a dialog. Extracted from WritableField
 * so it can be opened both by the inline field and directly from elsewhere
 * (e.g. a course-view context menu) once the writer context is available.
 */
export function WriterModal({
  open,
  onOpenChange,
  videoId,
  fieldId,
  modes,
  value,
  context,
  label,
  onApply,
  onAddFileFromClipboard,
  pageFields,
  view: viewProp,
  onViewChange,
  ctxTab: ctxTabProp,
  onCtxTabChange,
}: WriterModalProps) {
  const resolvedLabel = label ?? FIELD_LABELS[fieldId] ?? fieldId;

  const [viewInternal, setViewInternal] = useState<
    "writer" | "context" | "settings"
  >("writer");
  const view = viewProp ?? viewInternal;
  const handleViewChange = onViewChange ?? setViewInternal;

  const [ctxTabInternal, setCtxTabInternal] = useState<string | undefined>(
    undefined
  );
  const ctxTab = ctxTabProp ?? ctxTabInternal;
  const handleCtxTabChange = onCtxTabChange ?? setCtxTabInternal;

  const workingValueRef = useRef(value);
  const snapshotMessagesRef = useRef<Map<string, unknown[]>>(new Map());
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Snapshot the per-mode chat messages on the rising edge of `open` (once the
  // context is ready) so a Cancel can restore them. Mirrors the old
  // WritableField.handleOpen behaviour.
  const initedRef = useRef(false);
  useEffect(() => {
    if (open && context && !initedRef.current) {
      initedRef.current = true;
      workingValueRef.current = value;
      setIsDirty(false);
      setShowConfirmClose(false);
      const snap = new Map<string, unknown[]>();
      for (const m of modes) {
        snap.set(m, loadFieldMessages(videoId, fieldId, m));
      }
      snapshotMessagesRef.current = snap;
    }
    if (!open) initedRef.current = false;
  }, [open, context, value, modes, videoId, fieldId]);

  const handleApply = useCallback(
    (finalValue: string) => {
      onApply(finalValue);
      workingValueRef.current = finalValue;
      setIsDirty(false);
      onOpenChange(false);
    },
    [onApply, onOpenChange]
  );

  const handleCancel = useCallback(() => {
    for (const [m, msgs] of snapshotMessagesRef.current) {
      saveFieldMessages(videoId, fieldId, m as Mode, msgs);
    }
    workingValueRef.current = value;
    setIsDirty(false);
    setShowConfirmClose(false);
    onOpenChange(false);
  }, [videoId, fieldId, value, onOpenChange]);

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleRequestClose();
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
          {context ? (
            <WriterEngine
              videoId={videoId}
              fieldId={fieldId}
              modes={modes}
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
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading writer context…
            </div>
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
  );
}
