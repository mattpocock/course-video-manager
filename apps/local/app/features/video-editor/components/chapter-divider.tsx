import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import React from "react";
import type { ChapterDividerProps } from "../types";

export const ChapterDivider = React.forwardRef<
  HTMLButtonElement,
  ChapterDividerProps
>(
  (
    {
      name,
      isSelected,
      isCollapsed,
      onToggleCollapse,
      percentComplete,
      onClick,
      className,
      ...rest
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          "flex items-center gap-3 py-2 px-3 w-full allow-keydown",
          "sticky top-0 z-10 bg-background",
          "hover:bg-card/50 rounded-md transition-colors",
          "relative overflow-hidden",
          isSelected && "bg-muted outline-2 outline-ring",
          className
        )}
        onClick={onClick}
        {...rest}
      >
        {/* A folded Chapter that is playing: the same bar a playing Clip has,
            rolled up to the title, because none of its Clips are on screen. */}
        {percentComplete !== null && percentComplete !== undefined && (
          <div
            aria-hidden
            className="absolute top-0 left-0 h-full z-0 bg-blue-300/50 dark:bg-blue-700 rounded"
            style={{ width: `${percentComplete * 100}%` }}
          />
        )}
        {onToggleCollapse !== undefined && (
          <span
            aria-hidden
            className="relative z-10 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
          >
            {isCollapsed ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </span>
        )}
        <div className="relative z-10 border-t-2 border-border flex-1" />
        <span className="relative z-10 text-sm font-medium text-foreground whitespace-nowrap">
          {name}
        </span>
        <div className="relative z-10 border-t-2 border-border flex-1" />
      </button>
    );
  }
);
ChapterDivider.displayName = "ChapterDivider";
