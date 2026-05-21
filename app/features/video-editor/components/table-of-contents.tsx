import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ClipSection, FrontendId } from "../clip-state-reducer";

/**
 * Props for the TableOfContents component.
 */
export type TableOfContentsProps = {
  /** List of clip sections to display */
  chapters: ClipSection[];
  /** Set of selected clip/section IDs */
  selectedClipsSet: Set<FrontendId>;
  /** Callback when a section is clicked */
  onSectionClick: (sectionId: FrontendId, index: number) => void;
};

/**
 * TableOfContents component displays a navigable list of clip sections.
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
            onClick={() => props.onSectionClick(section.frontendId, index)}
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
