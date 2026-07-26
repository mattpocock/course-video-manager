/**
 * PROTOTYPE — throwaway. Variant C: the whole script, spotlit.
 *
 * The full document stays on screen and in place; a bright band at the read line
 * marks the live line and everything outside it is dimmed rather than hidden. A
 * Stream Deck press snaps the *next block* into the band, so movement is always
 * a deliberate, quantised jump — never a drift.
 *
 * The bet: keeping the surrounding text visible means never losing your place,
 * and block-snapping means a press always lands somewhere meaningful. The risk:
 * peripheral text is a distraction, and blocks may be too coarse a jump.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import type { ScriptBlock } from "./script-blocks";
import { textStyle, type PrototypeSettings } from "./prototype-settings";

export function VariantBand(props: {
  blocks: ScriptBlock[];
  settings: PrototypeSettings;
}) {
  const { settings, blocks } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef(new Map<string, HTMLParagraphElement>());
  const [activeIndex, setActiveIndex] = useState(0);
  const [drifting, setDrifting] = useState(false);

  const scrollToBlock = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, blocks.length - 1));
      setActiveIndex(clamped);
      const block = blocks[clamped];
      const scroller = scrollRef.current;
      const el = block ? blockRefs.current.get(block.id) : undefined;
      if (!scroller || !el) return;
      // Put the block's top exactly on the read line.
      const bandOffset = (scroller.clientHeight * settings.readLine) / 100;
      scroller.scrollTo({
        top: el.offsetTop - bandOffset,
        behavior: "smooth",
      });
    },
    [blocks, settings.readLine]
  );

  useTeleprompterActions({
    advance: () => scrollToBlock(activeIndex + 1),
    back: () => scrollToBlock(activeIndex - 1),
    togglePlay: () => setDrifting((v) => !v),
    reset: () => {
      setDrifting(false);
      scrollToBlock(0);
    },
  });

  // Optional slow drift, for the case where block jumps are too coarse and you
  // want the band to creep through a long paragraph.
  useEffect(() => {
    if (!drifting) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const scroller = scrollRef.current;
      if (scroller) {
        // Quarter of the crawl pace: this is trim, not transport.
        scroller.scrollTop += ((settings.wpm / 60) * settings.fontSize * 0.5) * dt;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drifting, settings.wpm, settings.fontSize]);

  const bandHeight = settings.fontSize * 2.4;

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
            ...textStyle(settings),
            width: `${settings.measure}ch`,
            maxWidth: "92vw",
            // Runway top and bottom so the first and last blocks can reach the band.
            paddingTop: `${settings.readLine}vh`,
            paddingBottom: "70vh",
          }}
        >
          {blocks.map((block, i) => (
            <p
              key={block.id}
              ref={(el) => {
                if (el) blockRefs.current.set(block.id, el);
                else blockRefs.current.delete(block.id);
              }}
              className={
                block.kind === "heading"
                  ? "mb-5 mt-10 font-bold uppercase tracking-widest text-sky-400"
                  : block.kind === "cue"
                    ? "mb-7 italic text-amber-400"
                    : "mb-7"
              }
              style={{
                // Dimming is per-block rather than a gradient overlay so the
                // active block stays fully legible right to its last line.
                opacity: i === activeIndex ? 1 : 0.28,
                transition: "opacity 180ms ease",
                fontSize:
                  block.kind === "heading"
                    ? `${settings.fontSize * 0.55}px`
                    : block.kind === "cue"
                      ? `${settings.fontSize * 0.7}px`
                      : undefined,
              }}
            >
              {block.kind === "cue" ? `[ ${block.text} ]` : block.text}
            </p>
          ))}
        </div>
      </div>

      {/* The band itself: a lit strip the active block's first lines sit inside. */}
      <div
        className="pointer-events-none absolute inset-x-0 border-y border-white/10 bg-white/[0.04]"
        style={{ top: `${settings.readLine}%`, height: `${bandHeight}px` }}
      />

      <div className="pointer-events-none absolute right-4 top-4 text-xs tabular-nums text-white/40">
        {activeIndex + 1} / {blocks.length}
        {drifting ? " · drifting" : ""}
      </div>
    </div>
  );
}
