import { cn } from "@/lib/utils";
import type { AnimaticChapterRow } from "./animatic-chapters";
import { AnimaticCommentThread } from "./animatic-comments";
import { MOCKUP_PROGRESS_VAR, progressFillStyle } from "./animatic-progress";
import { ANIMATIC_FPS, formatRunTime } from "./animatic-timeline";

/**
 * One Clip Mockup's row in the Animatic's sidebar. The same row whether it
 * sits under a divider or above the first one: the number on it is its
 * position in the Animatic, and `data-animatic-index` is its index in the
 * timeline, so a Chapter changes neither the count nor what a key walks.
 *
 * Its comment thread sits BESIDE the row's button, not inside it — a button
 * cannot hold another — so the row keeps room for it on the right.
 */
export const AnimaticMockupRow = (props: {
  readonly row: AnimaticChapterRow;
  readonly isActive: boolean;
  readonly isSelected: boolean;
  /** Stable for the life of the page, so a poll never replaces it. */
  readonly onPlay: (index: number) => void;
}) => {
  const { segment, index } = props.row;
  return (
    <li className="group relative">
      <button
        type="button"
        data-animatic-index={index}
        // A clicked row keeps the keys working: the shared guard ignores a
        // keydown on a plain button, and the author's next act after clicking a
        // moment is SPACE.
        className={cn(
          // `isolate` keeps this row's own z-indexed parts inside it. Without
          // it a `relative` box with no z-index of its own raises them into the
          // list's stacking context, where they tie with the sticky Chapter
          // divider and, being later in the list, paint OVER it.
          "allow-keydown relative isolate flex w-full gap-3 overflow-hidden border-b border-border py-2.5 pl-4 pr-12 text-left text-sm hover:bg-muted/60",
          props.isActive && "bg-muted",
          props.isSelected && !props.isActive && "bg-muted/50",
          props.isSelected &&
            "ring-1 ring-inset ring-sky-500/70 dark:ring-sky-400/60"
        )}
        onClick={() => props.onPlay(index)}
      >
        {/* The fill, behind the text, sized in CSS from the frame the player
            last wrote — so it moves without this row re-rendering. */}
        {props.isActive && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 z-0 bg-sky-500/20 dark:bg-sky-400/25"
            style={progressFillStyle(MOCKUP_PROGRESS_VAR)}
          />
        )}
        <span className="relative z-10 w-7 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {segment.mockup.position}
        </span>
        <span className="relative z-10 min-w-0 flex-1">
          <span className="block whitespace-pre-wrap">
            {segment.mockup.line}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
            {formatRunTime(segment.startFrame / ANIMATIC_FPS)}
            {(segment.mockup.imageMissing || segment.mockup.audioMissing) && (
              <span className="text-amber-600 dark:text-amber-300">
                {" "}
                · file missing
              </span>
            )}
          </span>
        </span>
      </button>
      <AnimaticCommentThread
        target={{ type: "clip-mockup", id: segment.mockup.id }}
        className="absolute right-2 top-2"
      />
    </li>
  );
};
