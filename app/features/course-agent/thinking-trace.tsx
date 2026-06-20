"use client";

import { ChevronDown } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function formatThinkingDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export const ThinkingTrace = memo(function ThinkingTrace({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (startRef.current !== null) {
        setElapsed(Math.round((Date.now() - startRef.current) / 1000));
        startRef.current = null;
      }
      return;
    }

    if (startRef.current === null) {
      startRef.current = Date.now();
    }

    const interval = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Math.round((Date.now() - startRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming]);

  const label =
    isStreaming && elapsed === 0
      ? "Thinking…"
      : `Thought for ${formatThinkingDuration(elapsed)}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown
          className={cn(
            "size-3 transition-transform",
            open ? "rotate-0" : "-rotate-90"
          )}
        />
        <span>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-4.5 whitespace-pre-wrap text-xs text-muted-foreground">
        {text}
      </CollapsibleContent>
    </Collapsible>
  );
});
