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
import { useEffect, useMemo, useRef } from "react";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { ScriptMarkdown } from "./script-markdown";
import { wordCount, type ScriptBlock } from "./script-blocks";
import { TYPE, cueStyle, textStyle } from "./teleprompter-settings";

export function TeleprompterCrawl(props: {
  blocks: ScriptBlock[];
  /** Crawl speed, in spoken words per minute. */
  wpm: number;
  /**
   * Whether the crawl is rolling. Owned by the session reducer, and only ever
   * started by hand — recording doesn't — see `teleprompter-session.ts`.
   */
  playing: boolean;
  onTogglePlay: () => void;
  onRewind: () => void;
}) {
  /** The node the rAF loop moves. Owns its `transform` — don't set it in JSX. */
  const contentRef = useRef<HTMLDivElement>(null);
  /** Just the prose, for measuring pace. Excludes the runway. */
  const proseRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const playingRef = useRef(props.playing);
  playingRef.current = props.playing;

  // Only prose is spoken: headings and cues are read silently, so counting
  // their words would slow the crawl below the pace actually being delivered.
  const totalWords = useMemo(
    () =>
      props.blocks
        .filter((block) => block.kind === "para" || block.kind === "list")
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
    togglePlay: props.onTogglePlay,
    reset: () => {
      targetRef.current = 0;
      offsetRef.current = 0;
      props.onRewind();
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
        const pxPerSecond = (props.wpm / 60) * pxPerWord;

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
  }, [props.wpm, totalWords]);

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
              <div
                key={block.id}
                className={
                  block.kind === "heading"
                    ? "mb-6 mt-12 font-semibold uppercase tracking-widest text-neutral-400"
                    : "mb-8"
                }
                style={
                  block.kind === "heading"
                    ? { fontSize: `${TYPE.fontSize * 0.55}px` }
                    : block.kind === "cue"
                      ? cueStyle()
                      : undefined
                }
              >
                {block.kind === "cue" ? (
                  `[ ${block.text} ]`
                ) : (
                  <ScriptMarkdown>{block.text}</ScriptMarkdown>
                )}
              </div>
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
    </div>
  );
}
