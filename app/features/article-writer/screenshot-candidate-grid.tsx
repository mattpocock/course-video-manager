import { cn } from "@/lib/utils";
import type { ScreenshotCandidate } from "./types";

export interface ScreenshotCandidateGridProps {
  candidates: ScreenshotCandidate[];
  /** Index of the selected candidate, or null before anything is picked. */
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  alt: string;
}

/**
 * The candidates, as a 2×2 grid of thumbnails.
 *
 * Two across rather than four, because the judgement being made here is whether
 * Matt is mid-blink or the terminal is mid-scroll — details that vanish at the
 * ~150px a four-across row leaves in the writer column. Two seconds of extra
 * height costs nothing on a panel that disappears as soon as it is used.
 *
 * No captions: with four frames side by side the images do the arguing, and a
 * sentence under each turns a glance into a read.
 */
export function ScreenshotCandidateGrid({
  candidates,
  selectedIndex,
  onSelect,
  alt,
}: ScreenshotCandidateGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {candidates.map((candidate, i) => (
        <button
          key={candidate.previewPath}
          type="button"
          onClick={() => onSelect(i)}
          className={cn(
            "group relative overflow-hidden rounded-md border-2 transition-colors",
            selectedIndex === i
              ? "border-primary"
              : "border-transparent hover:border-primary/40"
          )}
        >
          <img
            src={`/view-image?imagePath=${encodeURIComponent(candidate.previewPath)}`}
            alt={`${alt} — candidate ${i + 1}`}
            className="w-full"
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
            clip {candidate.clipIndex}
          </span>
        </button>
      ))}
    </div>
  );
}
