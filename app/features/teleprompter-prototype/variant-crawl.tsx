/**
 * PROTOTYPE — throwaway. Variant A: the classic teleprompter.
 *
 * Text crawls upward at a constant speed calibrated from words-per-minute, and
 * the Stream Deck's job is trim: play/pause, and nudge forward or back when the
 * crawl drifts out of sync with the delivery. Everything above the read line is
 * dimmed so the eye is pulled to the same place every time.
 *
 * Speed is self-calibrating: px/sec is derived from the rendered height per
 * word, so changing font size or measure doesn't change the reading pace.
 *
 * The bet this variant makes: motion is smooth and predictable, and the
 * discipline of keeping up is worth it. The risk: any hesitation compounds.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { wordCount, type ScriptBlock } from "./script-blocks";
import { textStyle, type PrototypeSettings } from "./prototype-settings";

export function VariantCrawl(props: {
  blocks: ScriptBlock[];
  settings: PrototypeSettings;
}) {
  const { settings } = props;
  const contentRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const totalWords = useMemo(
    () => props.blocks.reduce((sum, b) => sum + wordCount(b.text), 0),
    [props.blocks]
  );

  // One nudge ≈ three lines, which is about a sentence at typical settings.
  const nudge = settings.fontSize * 1.6 * 3;

  useTeleprompterActions({
    advance: () => {
      targetRef.current += nudge;
    },
    back: () => {
      targetRef.current = Math.max(0, targetRef.current - nudge);
    },
    togglePlay: () => setPlaying((v) => !v),
    reset: () => {
      targetRef.current = 0;
      offsetRef.current = 0;
      setPlaying(false);
    },
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const el = contentRef.current;
      if (el) {
        const height = el.scrollHeight;
        // Height per word × words per second = the pace the script was written at.
        const pxPerWord = totalWords > 0 ? height / totalWords : 0;
        const pxPerSecond = (settings.wpm / 60) * pxPerWord;

        if (playingRef.current) targetRef.current += pxPerSecond * dt;
        targetRef.current = Math.max(0, Math.min(targetRef.current, height));

        // Chase the target rather than snapping to it: constant-velocity crawl
        // keeps a constant (invisible) lag, while nudges arrive as a smooth ease.
        offsetRef.current += (targetRef.current - offsetRef.current) * 0.18;
        el.style.transform = `translateY(${-offsetRef.current}px)`;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [settings.wpm, totalWords]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Mirroring lives on the wrapper: the inner node's transform is owned by
          the rAF loop, so the two can't share a property. */}
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{
          top: `${settings.readLine}%`,
          transform: settings.mirror ? "scaleX(-1)" : undefined,
        }}
      >
        <div
          ref={contentRef}
          className="will-change-transform"
          style={{
            ...textStyle(settings),
            width: `${settings.measure}ch`,
            maxWidth: "92vw",
            transform: "translateY(0px)",
          }}
        >
          {props.blocks.map((block) => (
            <p
              key={block.id}
              className={
                block.kind === "heading"
                  ? "mb-6 mt-12 font-bold uppercase tracking-widest text-sky-400/80"
                  : block.kind === "cue"
                    ? "mb-8 italic text-amber-400/80"
                    : "mb-8"
              }
              style={
                block.kind === "heading"
                  ? { fontSize: `${settings.fontSize * 0.55}px` }
                  : block.kind === "cue"
                    ? { fontSize: `${settings.fontSize * 0.7}px` }
                    : undefined
              }
            >
              {block.kind === "cue" ? `[ ${block.text} ]` : block.text}
            </p>
          ))}
          {/* Runway so the last line can reach the read line. */}
          <div style={{ height: "60vh" }} />
        </div>
      </div>

      {/* Everything already spoken fades out — the eye stops chasing it. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black via-black/85 to-transparent"
        style={{ height: `${settings.readLine}%` }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black to-transparent" />

      {!playing && (
        <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest text-white/60">
          Paused — P or Stream Deck to roll
        </div>
      )}
    </div>
  );
}
