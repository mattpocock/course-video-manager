import { cn } from "@/lib/utils";
import React from "react";
import type { ChapterDividerProps } from "../types";

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
