"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PencilIcon } from "lucide-react";
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
  onApply: (newValue: string) => void;
  context: WriterContext;
  modes?: Mode[];
  label?: string;
  placeholder?: string;
  className?: string;
}

export function WritableField({
  videoId,
  fieldId,
  value,
  onApply,
  context,
  modes,
  label,
  placeholder,
  className,
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

  const handleApply = useCallback(() => {
    onApply(workingValueRef.current);
    setIsDirty(false);
    setOpen(false);
  }, [onApply, setOpen]);

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
        className={`group relative cursor-pointer rounded-md border border-input bg-background hover:border-ring transition-colors ${className ?? ""}`}
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpen();
          }
        }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
          <span className="text-xs font-medium text-muted-foreground">
            {resolvedLabel}
          </span>
          <PencilIcon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="px-3 py-2 min-h-[80px] max-h-[200px] overflow-hidden">
          {value ? (
            <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-6 font-mono">
              {value}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {placeholder ?? "Click to open writer..."}
            </p>
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
          className="max-w-[94vw] w-[94vw] h-[82vh] flex flex-col p-0 gap-0"
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
