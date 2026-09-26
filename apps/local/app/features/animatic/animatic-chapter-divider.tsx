import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAPTER_PROGRESS_VAR, progressFillStyle } from "./animatic-progress";
import { formatRunTime } from "./animatic-timeline";

/**
 * A Clip Mockup Chapter in the Animatic's sidebar.
 *
 * THE SAME CONTROL THE VIDEO EDITOR HAS. The markup is the editor's
 * `chapter-divider.tsx` — rule, title, rule, with the chevron first — and the
 * SAME THEME TOKENS, so the two surfaces read as one thing in either theme. It
 * is opaque IN EVERY STATE, hover included, so it can be made sticky, but the
 * caller owns the sticking: in a list, the row that wraps it is the scroll
 * container's own child, and a `sticky` button inside that wrapper would never
 * leave it. The caller also owns the LAYER: it must put that wrapper above the
 * rows, and a row must not let its own z-indexed parts out, or the row paints
 * through this one.
 *
 * It carries the ROLLED-UP RUN TIME of the rows below it, which is what makes
 * "this Chapter is eleven minutes" answerable at a glance on a thirty-four
 * minute watch. It does NOT carry their count: the numbered rows below it and
 * the `14 / 61` badge on the picture both say where the author is, and a second
 * count on every divider was noise between the title and the minutes. An empty
 * Chapter has no seek to offer either: `onClick` is left off, and the title does
 * not move the playhead.
 *
 * The chevron is drawn only when a caller passes `onToggleCollapse`, and it
 * stops the click going further. THE SPLIT IS LOAD-BEARING: the chevron opens
 * and closes, the rest of the button seeks.
 *
 * A FOLDED CHAPTER IS THE ONLY THING ON SCREEN FOR ITS ROWS, so it is what
 * shows them playing: `isPlaying` draws the fill bar across the divider itself,
 * filling over the whole Chapter's run time. Nothing else on the page would
 * say that the eleven minutes behind this one title are the eleven minutes
 * being heard. See `animatic-progress.ts`.
 */
export const AnimaticChapterDivider = (props: {
  readonly name: string;
  /** Its rows' run time, in seconds. Zero for a Chapter holding nothing. */
  readonly runTimeSeconds: number;
  /** Left off by a Chapter with nothing under it, which cannot be seeked to. */
  readonly onClick?: () => void;
  readonly isCollapsed?: boolean;
  /** Left off while nothing can collapse — then no chevron is drawn. */
  readonly onToggleCollapse?: () => void;
  /**
   * The playhead is inside this Chapter and its rows are folded away. Passing
   * it on an OPEN Chapter would double the row's own bar.
   */
  readonly isPlaying?: boolean;
}) => {
  return (
    <button
      type="button"
      // A clicked divider keeps the keys working, exactly as a row does: the
      // shared guard ignores a keydown on a plain button.
      className={cn(
        // `isolate` keeps the fill and the title inside this button's own
        // stacking context, so neither can be raised into the list's.
        "allow-keydown relative isolate flex w-full items-center gap-3 overflow-hidden",
        "border-b border-border bg-background px-4 py-2 text-left",
        // OPAQUE ON HOVER TOO. A translucent hover replaces the background
        // outright, and a sticky header is exactly where a row would then be
        // read through the title.
        props.onClick && "hover:bg-muted",
        props.isPlaying && "bg-muted"
      )}
      onClick={props.onClick}
    >
      {/* The fill, behind everything, sized in CSS from the frame the player
          last wrote. */}
      {props.isPlaying && (
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 z-0 bg-sky-500/20 dark:bg-sky-400/25"
          style={progressFillStyle(CHAPTER_PROGRESS_VAR)}
        />
      )}
      {props.onToggleCollapse !== undefined && (
        <span
          aria-hidden
          className="relative z-10 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleCollapse?.();
          }}
        >
          {props.isCollapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </span>
      )}
      <div className="relative z-10 h-0 flex-1 border-t-2 border-border" />
      <span className="relative z-10 whitespace-nowrap text-sm font-semibold">
        {props.name}
      </span>
      <span className="relative z-10 font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatRunTime(props.runTimeSeconds)}
      </span>
      <div className="relative z-10 h-0 flex-1 border-t-2 border-border" />
    </button>
  );
};
