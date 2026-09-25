import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRunTime } from "./animatic-timeline";

/**
 * A Clip Mockup Chapter in the Animatic's sidebar.
 *
 * THE SAME CONTROL THE VIDEO EDITOR HAS. The markup is the editor's
 * `chapter-divider.tsx` — rule, title, rule, with the chevron first — so the
 * two surfaces read as one thing; only the colours are translated, because this
 * sidebar is dark. It is opaque so it can be made sticky, but the caller owns
 * the sticking: in a list, the row that wraps it is the scroll container's own
 * child, and a `sticky` button inside that wrapper would never leave it.
 *
 * It carries the ROLLED-UP count and run time of the rows below it, which is
 * what makes "this Chapter is eleven minutes" answerable at a glance on a
 * thirty-four minute watch. An empty Chapter reads as a plain zero and has no
 * seek to offer: `onClick` is left off, and the title does not move the
 * playhead.
 *
 * The chevron is drawn only when a caller passes `onToggleCollapse`, and it
 * stops the click going further. THE SPLIT IS LOAD-BEARING: the chevron opens
 * and closes, the rest of the button seeks.
 */
export const AnimaticChapterDivider = (props: {
  readonly name: string;
  /** Clip Mockups under this title. */
  readonly mockupCount: number;
  /** Their run time, in seconds. */
  readonly runTimeSeconds: number;
  /** Left off by a Chapter with nothing under it, which cannot be seeked to. */
  readonly onClick?: () => void;
  readonly isCollapsed?: boolean;
  /** Left off while nothing can collapse — then no chevron is drawn. */
  readonly onToggleCollapse?: () => void;
}) => {
  return (
    <button
      type="button"
      // A clicked divider keeps the keys working, exactly as a row does: the
      // shared guard ignores a keydown on a plain button.
      className={cn(
        "allow-keydown flex w-full items-center gap-3",
        "border-b border-white/5 bg-neutral-950 px-4 py-2 text-left",
        props.onClick && "hover:bg-white/10"
      )}
      onClick={props.onClick}
    >
      {props.onToggleCollapse !== undefined && (
        <span
          aria-hidden
          className="shrink-0 text-white/40 hover:text-white"
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
      <div className="h-0 flex-1 border-t-2 border-white/10" />
      <span className="whitespace-nowrap text-sm font-semibold">
        {props.name}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-white/40">
        {props.mockupCount === 0
          ? "0"
          : `${props.mockupCount} in ${formatRunTime(props.runTimeSeconds)}`}
      </span>
      <div className="h-0 flex-1 border-t-2 border-white/10" />
    </button>
  );
};
