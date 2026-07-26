/**
 * PROTOTYPE — throwaway. Variant B: no motion at all.
 *
 * One chunk on screen at a time, pinned at the read line, at whatever size it
 * takes to be readable from across the room. The Stream Deck is the only thing
 * that moves it. Optional auto-advance dwells on each chunk for as long as its
 * word count says it should take to say.
 *
 * The bet: with nothing scrolling, the eye never has to track — it just reads a
 * fixed point, which is the closest thing to "looking down the lens". The risk:
 * losing the run-up to the next sentence, so a ghost of what's coming sits below.
 */
import { useEffect, useRef, useState } from "react";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { wordCount, type ScriptStep } from "./script-blocks";
import { textStyle, type PrototypeSettings } from "./prototype-settings";

export function VariantStepper(props: {
  steps: ScriptStep[];
  settings: PrototypeSettings;
}) {
  const { settings, steps } = props;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const clamp = (i: number) => Math.max(0, Math.min(i, steps.length - 1));

  useTeleprompterActions({
    advance: () => setIndex((i) => clamp(i + 1)),
    back: () => setIndex((i) => clamp(i - 1)),
    togglePlay: () => setPlaying((v) => !v),
    reset: () => {
      setIndex(0);
      setPlaying(false);
    },
  });

  // Auto-advance dwells for as long as the chunk should take to say out loud,
  // plus a beat. Whether that's usable at all is one of the things to find out.
  const current = steps[index];
  const dwellMs = current
    ? (wordCount(current.text) / Math.max(settings.wpm, 1)) * 60_000 + 400
    : 0;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) return;
    timerRef.current = setTimeout(() => setIndex((i) => clamp(i + 1)), dwellMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, dwellMs, steps.length]);

  const previous = index > 0 ? steps[index - 1] : undefined;
  const next = steps[index + 1];

  const kindClass = (kind: ScriptStep["kind"]) =>
    kind === "heading"
      ? "font-bold uppercase tracking-widest text-sky-400"
      : kind === "cue"
        ? "italic text-amber-400"
        : "";

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Progress is worth having when there's no scrollbar to imply it. */}
      <div className="absolute inset-x-0 top-0 h-1 bg-white/5">
        <div
          className="h-full bg-sky-500/70 transition-all duration-200"
          style={{
            width: `${steps.length ? ((index + 1) / steps.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="absolute right-4 top-4 text-xs tabular-nums text-white/40">
        {index + 1} / {steps.length}
        {playing ? " · auto" : ""}
      </div>

      <div
        className="absolute inset-x-0 flex flex-col items-center gap-8 px-8"
        style={{
          top: `${settings.readLine}%`,
          transform: settings.mirror
            ? "translateY(-50%) scaleX(-1)"
            : "translateY(-50%)",
        }}
      >
        {previous && (
          <p
            className="max-w-full truncate text-center text-white/20"
            style={{
              width: `${settings.measure}ch`,
              fontSize: `${settings.fontSize * 0.45}px`,
            }}
          >
            {previous.text}
          </p>
        )}

        <p
          className={current ? kindClass(current.kind) : ""}
          style={{
            ...textStyle(settings),
            width: `${settings.measure}ch`,
            maxWidth: "92vw",
          }}
        >
          {current
            ? current.kind === "cue"
              ? `[ ${current.text} ]`
              : current.text
            : "— end of script —"}
        </p>

        {next && (
          <p
            className="max-w-full text-center text-white/30"
            style={{
              width: `${settings.measure}ch`,
              fontSize: `${settings.fontSize * 0.5}px`,
              lineHeight: 1.4,
            }}
          >
            {next.kind === "cue" ? `[ ${next.text} ]` : next.text}
          </p>
        )}
      </div>
    </div>
  );
}
