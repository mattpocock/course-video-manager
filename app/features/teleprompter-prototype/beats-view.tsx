/**
 * PROTOTYPE — throwaway. The Beats reading model.
 *
 * Beats aren't prose — they're a dozen short Title-Case labels with a sentence
 * of description each — so none of the three script variants apply. A crawl
 * through twelve bullet points is meaningless. This is the one sensible shape:
 * the whole plan visible as a checklist, the current beat spotlit and expanded
 * to show its description, everything else collapsed to its title.
 *
 * Kind icons and labels are imported from the real Beats tab rather than
 * redrawn, so the plan reads the same on the glass as it does in the editor.
 *
 * Stream Deck: advance/back move the spotlight, play toggles descriptions
 * (worth knowing whether you want them at all mid-take), reset returns to the top.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  DEFAULT_BEAT_KIND,
  type BeatKind,
} from "@/features/beats/beat-kinds";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { textStyle, type PrototypeSettings } from "./prototype-settings";

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

export function BeatsView(props: {
  beats: TeleprompterBeat[];
  settings: PrototypeSettings;
}) {
  const { beats, settings } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeIndex, setActiveIndex] = useState(0);
  const [showDescriptions, setShowDescriptions] = useState(true);

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
    togglePlay: () => setShowDescriptions((v) => !v),
    reset: () => goTo(0),
  });

  // Keep the active beat pinned to the read line. Runs after the expand/collapse
  // re-render so it accounts for the description's height.
  useEffect(() => {
    const beat = beats[activeIndex];
    const scroller = scrollRef.current;
    const row = beat ? rowRefs.current.get(beat.id) : undefined;
    if (!scroller || !row) return;
    const anchor = (scroller.clientHeight * settings.readLine) / 100;
    scroller.scrollTo({
      top: row.offsetTop - anchor + row.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex, beats, settings.readLine, showDescriptions, settings.fontSize]);

  const base = textStyle(settings);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ transform: settings.mirror ? "scaleX(-1)" : undefined }}
      >
        <div
          className="mx-auto"
          style={{
            width: `${settings.measure}ch`,
            maxWidth: "92vw",
            paddingTop: `${settings.readLine}vh`,
            paddingBottom: "70vh",
          }}
        >
          {beats.map((beat, i) => {
            const kind = asBeatKind(beat.kind);
            const Icon = BEAT_KIND_ICONS[kind];
            const isActive = i === activeIndex;

            return (
              <div
                key={beat.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(beat.id, el);
                  else rowRefs.current.delete(beat.id);
                }}
                className="mb-6 flex gap-3"
                style={{
                  opacity: isActive ? 1 : 0.3,
                  transition: "opacity 180ms ease",
                  // Done beats fade further than upcoming ones — the plan reads
                  // as a position, not just a list.
                  ...(i < activeIndex ? { opacity: 0.16 } : {}),
                }}
              >
                <Icon
                  className="mt-1 shrink-0 text-sky-400"
                  style={{
                    width: settings.fontSize * (isActive ? 0.62 : 0.44),
                    height: settings.fontSize * (isActive ? 0.62 : 0.44),
                  }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div
                    style={{
                      ...base,
                      textAlign: "left",
                      fontSize: `${settings.fontSize * (isActive ? 1 : 0.62)}px`,
                    }}
                  >
                    {beat.title || BEAT_KIND_LABELS[kind]}
                  </div>
                  {isActive && showDescriptions && beat.description && (
                    <div
                      style={{
                        ...base,
                        textAlign: "left",
                        fontSize: `${settings.fontSize * 0.55}px`,
                        opacity: 0.7,
                        marginTop: settings.fontSize * 0.2,
                      }}
                    >
                      {beat.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute right-4 top-4 text-xs tabular-nums text-white/40">
        {activeIndex + 1} / {beats.length}
        {showDescriptions ? "" : " · titles only"}
      </div>
    </div>
  );
}
