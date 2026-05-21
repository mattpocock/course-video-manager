import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Chapter, FrontendId } from "../clip-state-reducer";

/**
 * Props for the TableOfContents component.
 */
export type TableOfContentsProps = {
  /** List of chapters to display */
  chapters: Chapter[];
  selectedClipsSet: Set<FrontendId>;
  onChapterClick: (chapterId: FrontendId, index: number) => void;
};

/**
 * TableOfContents component displays a navigable list of chapters.
 * Allows users to jump to specific sections in the timeline and shows
 * which section is currently selected.
 */
export function TableOfContents(props: TableOfContentsProps) {
  if (props.chapters.length === 0) return null;

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-2 pr-4">
        {props.chapters.map((section, index) => (
          <button
            key={section.frontendId}
            onClick={() => props.onChapterClick(section.frontendId, index)}
            className={cn(
              "w-full text-left px-3 py-2 rounded text-sm hover:bg-muted transition-colors",
              props.selectedClipsSet.has(section.frontendId) &&
                "bg-muted font-medium"
            )}
          >
            {section.name}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
