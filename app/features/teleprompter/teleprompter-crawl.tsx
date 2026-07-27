/**
 * The script on the glass: a continuous upward crawl.
 *
 * Speed is expressed in spoken words per minute and converted to pixels per
 * second using the height the prose actually renders at, so changing the type
 * doesn't change the reading pace. The runway below the text is deliberately
 * excluded from that measurement — it's padding, not words, and counting it
 * would inflate the pace on short scripts.
 *
 * The Stream Deck's job here is trim: play/pause, and nudge forward or back
 * when the crawl drifts out of sync with the delivery. The mouse wheel scrolls
 * directly, which is the fastest way to reach a particular line between takes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { wordCount, type ScriptBlock } from "./script-blocks";
import {
  TYPE,
  textStyle,
  type TeleprompterSettings,
} from "./teleprompter-settings";

export function TeleprompterCrawl(props: {
  blocks: ScriptBlock[];
  settings: TeleprompterSettings;
}) {
  const { settings } = props;
  /** The node the rAF loop moves. Owns its `transform` — don't set it in JSX. */
  const contentRef = useRef<HTMLDivElement>(null);
  /** Just the prose, for measuring pace. Excludes the runway. */
  const proseRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // Only prose is spoken: headings and cues are read silently, so counting
  // their words would slow the crawl below the pace actually being delivered.
  const totalWords = useMemo(
    () =>
      props.blocks
        .filter((block) => block.kind === "para")
        .reduce((sum, block) => sum + wordCount(block.text), 0),
    [props.blocks]
  );

  // One nudge ≈ three lines, which is about a sentence at these settings.
  const nudge = TYPE.fontSize * TYPE.lineHeight * 3;

  const scrollBy = (delta: number) => {
    targetRef.current = Math.max(0, targetRef.current + delta);
    offsetRef.current = Math.max(0, offsetRef.current + delta);
  };

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
        const proseHeight = proseRef.current?.scrollHeight ?? 0;
        // Height per word × words per second = the pace the script reads at.
        const pxPerWord = totalWords > 0 ? proseHeight / totalWords : 0;
        const pxPerSecond = (settings.wpm / 60) * pxPerWord;

        if (playingRef.current) targetRef.current += pxPerSecond * dt;
        targetRef.current = Math.max(
          0,
          Math.min(targetRef.current, el.scrollHeight)
        );

        // Chase the target rather than snapping to it: a constant-velocity crawl
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
    <div
      className="relative h-full w-full overflow-hidden bg-black"
      onWheel={(e) => scrollBy(e.deltaY)}
    >
      <div
        className="absolute inset-x-0 flex justify-center"
        style={{ top: `${TYPE.readLine}%` }}
      >
        <div
          ref={contentRef}
          className="will-change-transform"
          style={{
            ...textStyle(),
            width: `${TYPE.measure}ch`,
            maxWidth: "92vw",
          }}
        >
          <div ref={proseRef}>
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
                    ? { fontSize: `${TYPE.fontSize * 0.55}px` }
                    : block.kind === "cue"
                      ? { fontSize: `${TYPE.fontSize * 0.7}px` }
                      : undefined
                }
              >
                {block.kind === "cue" ? `[ ${block.text} ]` : block.text}
              </p>
            ))}
          </div>
          {/* Runway so the last line can still reach the read line. */}
          <div style={{ height: "60vh" }} />
        </div>
      </div>

      {/* Everything already spoken fades out — the eye stops chasing it. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black via-black/85 to-transparent"
        style={{ height: `${TYPE.readLine}%` }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black to-transparent" />

      {!playing && (
        <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-widest text-white/60">
          Paused
        </div>
      )}
    </div>
  );
}
