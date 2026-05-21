import { cn } from "@/lib/utils";
import React from "react";
import type { ChapterDividerProps } from "../types";

/**
 * Visual divider component for chapters in the timeline.
 *
 * Displays a horizontal line with the section name in the center.
 * Uses sticky positioning to stay visible while scrolling through clips.
 *
 * @example
 * <ChapterDivider
 *   name="Introduction"
 *   isSelected={selectedClipsSet.has(sectionId)}
 *   onClick={() => handleSectionClick(sectionId)}
 * />
 */
export const ChapterDivider = React.forwardRef<
  HTMLButtonElement,
  ChapterDividerProps
>(({ name, isSelected, onClick, className, ...rest }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "flex items-center gap-3 py-2 px-3 w-full allow-keydown",
        "sticky top-0 z-10 bg-background",
        "hover:bg-card/50 rounded-md transition-colors",
        isSelected && "bg-muted outline-2 outline-ring",
        className
      )}
      onClick={onClick}
      {...rest}
    >
      <div className="border-t-2 border-border flex-1" />
      <span className="text-sm font-medium text-foreground whitespace-nowrap">
        {name}
      </span>
      <div className="border-t-2 border-border flex-1" />
    </button>
  );
});
ChapterDivider.displayName = "ChapterDivider";
