/**
 * The Beats plan on the glass.
 *
 * Beats aren't prose — they're a dozen short Title-Case labels with a sentence
 * of description each — so nothing about the script's crawl applies here.
 * Nothing moves on its own and play/pause does nothing: the whole plan is on
 * the glass at once, every beat showing its description in full — a step
 * smaller than its title, so the titles still carry the shape of the plan when
 * you only glance. The plan as a whole runs wider and a step larger than the
 * script does, because it's taken in at a glance rather than read out line by
 * line. Nothing dims and no row expands or collapses, so the beat
 * you glanced at a second ago is still where you left it, still legible.
 * Position is carried by scroll alone rather than by fading the beats around
 * it.
 *
 * Kind icons and labels are imported from the real Beats tab rather than
 * redrawn, so the plan reads the same on the glass as it does in the editor.
 *
 * Stream Deck: advance/back scroll to the next/previous beat, reset returns to
 * the top.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  DEFAULT_BEAT_KIND,
  type BeatKind,
} from "@/features/beats/beat-kinds";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { LinkedText } from "./linked-text";
import { TYPE, textStyle } from "./teleprompter-settings";

export type TeleprompterBeat = {
  id: string;
  kind: string;
  title: string;
  description: string;
};

function asBeatKind(kind: string): BeatKind {
  return kind in BEAT_KIND_LABELS
    ? (kind as BeatKind)
    : (DEFAULT_BEAT_KIND as BeatKind);
}

/**
 * Whether words on the glass are highlighted right now.
 *
 * A drag across a beat's words ends in a `click` on the row just as a plain
 * click does, and the row's job — moving the spotlight — scrolls the plan out
 * from under the text you were half way through highlighting. A collapsed
 * selection is only the caret a plain click leaves behind, so it takes actual
 * words to hold the spotlight still.
 *
 * Only drags are caught. A double-click's first click arrives with nothing yet
 * selected and is indistinguishable from a single one at the moment it fires,
 * so double-clicking a word on a beat other than the active one still moves the
 * spotlight out from under it.
 */
function hasSelectedText(): boolean {
  const selection = window.getSelection();
  return (
    !!selection && !selection.isCollapsed && selection.toString().trim() !== ""
  );
}

export function BeatsView(props: { beats: TeleprompterBeat[] }) {
  const { beats } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeIndex, setActiveIndex] = useState(0);

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, beats.length - 1));
      setActiveIndex(clamped);
    },
    [beats.length]
  );

  useTeleprompterActions({
    advance: () => goTo(activeIndex + 1),
    back: () => goTo(activeIndex - 1),
    // Deliberately inert. Play/pause belongs to the script crawl; there is
    // nothing here for it to start or stop, and a key that silently does
    // nothing beats one that changes the layout you're reading off.
    togglePlay: () => {},
    reset: () => goTo(0),
  });

  // Keep the active beat pinned to the read line.
  useEffect(() => {
    const beat = beats[activeIndex];
    const scroller = scrollRef.current;
    const row = beat ? rowRefs.current.get(beat.id) : undefined;
    if (!scroller || !row) return;
    const anchor = (scroller.clientHeight * TYPE.readLine) / 100;
    scroller.scrollTo({
      top: row.offsetTop - anchor + row.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex, beats]);

  const base = textStyle();

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="mx-auto"
          style={{
            width: `${TYPE.beatsMeasure}ch`,
            maxWidth: "92vw",
            paddingTop: `${TYPE.readLine}vh`,
            paddingBottom: "70vh",
          }}
        >
          {beats.map((beat, i) => {
            const kind = asBeatKind(beat.kind);
            const Icon = BEAT_KIND_ICONS[kind];
            // Every beat's title reads a step above the script's size, at full
            // strength — this is glass at arm's length, and anything dimmed
            // isn't readable from where you stand. The icon gutter and the
            // description below both take their size from here, so the row
            // scales as one.
            const titleSize = TYPE.fontSize * TYPE.beatsScale;
            const descriptionSize = titleSize * TYPE.beatDescriptionScale;

            return (
              <div
                key={beat.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(beat.id, el);
                  else rowRefs.current.delete(beat.id);
                }}
                // Clicking a beat moves the spotlight. Advance normally comes
                // from the Stream Deck, but the popup only receives keystrokes
                // when it has OS focus — which it won't while you're looking at
                // the Prompter — so there needs to be a way in that doesn't
                // depend on that.
                onClick={() => {
                  if (hasSelectedText()) return;
                  setActiveIndex(i);
                }}
                className="mb-6 flex cursor-pointer gap-3"
              >
                {/* Centred inside a box exactly one line tall, so the icon sits
                    on the title's first line whatever the size or line height. */}
                <span
                  className="flex shrink-0 items-center justify-center"
                  style={{
                    height: `${titleSize * TYPE.lineHeight}px`,
                    width: titleSize * 0.62,
                  }}
                >
                  <Icon
                    className="text-neutral-400"
                    style={{
                      width: titleSize * 0.62,
                      height: titleSize * 0.62,
                    }}
                    aria-hidden
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    style={{
                      ...base,
                      textAlign: "left",
                      fontSize: `${titleSize}px`,
                    }}
                  >
                    {beat.title || BEAT_KIND_LABELS[kind]}
                  </div>
                  {beat.description && (
                    <div
                      style={{
                        ...base,
                        textAlign: "left",
                        fontSize: `${descriptionSize}px`,
                        // A step back from the title in size and in colour: the
                        // description is context, not the line you read off the
                        // glass.
                        color: "var(--color-neutral-400)",
                        marginTop: descriptionSize * 0.2,
                      }}
                    >
                      <LinkedText>{beat.description}</LinkedText>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
