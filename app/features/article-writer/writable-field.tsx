"use client";

import { useCallback, useRef } from "react";
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

  const workingValueRef = useRef(value);
  const snapshotMessagesRef = useRef<Map<string, unknown[]>>(new Map());

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

  const handleOpen = useCallback(() => {
    workingValueRef.current = value;
    const snap = new Map<string, unknown[]>();
    for (const m of resolvedModes) {
      snap.set(m, loadFieldMessages(videoId, fieldId, m));
    }
    snapshotMessagesRef.current = snap;
    setOpen(true);
  }, [value, resolvedModes, videoId, fieldId, setOpen]);

  const handleApply = useCallback(() => {
    onApply(workingValueRef.current);
    setOpen(false);
  }, [onApply, setOpen]);

  const handleCancel = useCallback(() => {
    for (const [m, msgs] of snapshotMessagesRef.current) {
      saveFieldMessages(videoId, fieldId, m as Mode, msgs);
    }
    workingValueRef.current = value;
    setOpen(false);
  }, [videoId, fieldId, value, setOpen]);

  const handleDocumentChange = useCallback((doc: string) => {
    workingValueRef.current = doc;
  }, []);

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
          if (!open) handleCancel();
        }}
      >
        <DialogContent
          className="max-w-[94vw] w-[94vw] h-[82vh] flex flex-col p-0 gap-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{resolvedLabel}</DialogTitle>
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <h2 className="text-sm font-semibold">{resolvedLabel}</h2>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {isOpen && (
              <WriterEngine
                videoId={videoId}
                fieldId={fieldId}
                modes={resolvedModes}
                initialDocument={value}
                layout="modal"
                context={context}
                onDocumentChange={handleDocumentChange}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
