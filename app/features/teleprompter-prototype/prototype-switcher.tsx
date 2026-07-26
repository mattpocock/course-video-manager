/**
 * PROTOTYPE — throwaway.
 *
 * Two jobs. The visible tab control flips between Beats and Script — that's a
 * real question about what belongs on the glass, so it's a first-class control,
 * not a hidden param. Everything else is the tuning popup: type, colour,
 * position, speed. The idea is that you settle how this should look by moving
 * sliders, not by describing it and waiting for a rebuild.
 *
 * Deliberately high-contrast and ugly so it never reads as part of the design
 * being judged, collapsible to a pill, and never rendered in a production build.
 *
 * ← / → cycle script variants; the teleprompter itself uses J/K/Space/P/R.
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Settings2, X } from "lucide-react";
import { RETICULE_STYLES } from "./focus-reticule";
import {
  FONT_FAMILY_KEYS,
  SOURCES,
  TEXT_COLOR_KEYS,
  VARIANTS,
  VARIANT_NAMES,
  type PrototypeSettings,
} from "./prototype-settings";

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-white/80">
      <span className="w-20 shrink-0 text-right">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-28 accent-fuchsia-400"
      />
      <span className="w-14 tabular-nums text-white/60">
        {props.value}
        {props.suffix ?? ""}
      </span>
    </label>
  );
}

function Cycle<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const i = props.options.indexOf(props.value);
        props.onChange(props.options[(i + 1) % props.options.length]!);
      }}
      className="rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
    >
      {props.label}: {props.value}
    </button>
  );
}

export function PrototypeSwitcher(props: {
  settings: PrototypeSettings;
  onChange: <K extends keyof PrototypeSettings>(
    key: K,
    value: PrototypeSettings[K]
  ) => void;
  /** Editor connection state, shown so you never wonder if it's stuck. */
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const { settings, onChange } = props;
  const isScript = settings.source === "script";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Variants only exist for the Script — Beats has one sensible shape.
      if (settings.source !== "script") return;
      e.preventDefault();
      const index = VARIANTS.indexOf(settings.variant);
      const delta = e.key === "ArrowRight" ? 1 : -1;
      onChange(
        "variant",
        VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]!
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.variant, settings.source, onChange]);

  if (import.meta.env.PROD) return null;

  const cycleVariant = (delta: number) => {
    const index = VARIANTS.indexOf(settings.variant);
    onChange(
      "variant",
      VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]!
    );
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2">
      {open && (
        <div className="mb-2 flex max-h-[70vh] w-[min(92vw,44rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-fuchsia-400/40 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">
              Type
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Slider
                label="Size"
                value={settings.fontSize}
                min={16}
                max={120}
                suffix="px"
                onChange={(v) => onChange("fontSize", v)}
              />
              <Slider
                label="Weight"
                value={settings.fontWeight}
                min={300}
                max={800}
                step={100}
                onChange={(v) => onChange("fontWeight", v)}
              />
              <Slider
                label="Line height"
                value={settings.lineHeight}
                min={1}
                max={2.4}
                step={0.05}
                onChange={(v) => onChange("lineHeight", v)}
              />
              <Slider
                label="Tracking"
                value={settings.letterSpacing}
                min={-0.05}
                max={0.2}
                step={0.005}
                suffix="em"
                onChange={(v) => onChange("letterSpacing", v)}
              />
              <Slider
                label="Measure"
                value={settings.measure}
                min={12}
                max={80}
                suffix="ch"
                onChange={(v) => onChange("measure", v)}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">
              Position &amp; motion
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Slider
                label="Eyeline"
                value={settings.eyeline}
                min={5}
                max={90}
                suffix="%"
                onChange={(v) => onChange("eyeline", v)}
              />
              <Slider
                label="Read line"
                value={settings.readLine}
                min={5}
                max={90}
                suffix="%"
                onChange={(v) => onChange("readLine", v)}
              />
              <Slider
                label="Speed"
                value={settings.wpm}
                min={60}
                max={260}
                step={5}
                suffix="wpm"
                onChange={(v) => onChange("wpm", v)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
            <Cycle
              label="Font"
              value={settings.fontFamily}
              options={FONT_FAMILY_KEYS}
              onChange={(v) => onChange("fontFamily", v)}
            />
            <Cycle
              label="Colour"
              value={settings.textColor}
              options={TEXT_COLOR_KEYS}
              onChange={(v) => onChange("textColor", v)}
            />
            <Cycle
              label="Align"
              value={settings.align}
              options={["left", "center"] as const}
              onChange={(v) => onChange("align", v)}
            />
            <Cycle
              label="Reticule"
              value={settings.reticule}
              options={RETICULE_STYLES}
              onChange={(v) => onChange("reticule", v)}
            />
            <button
              type="button"
              onClick={() => onChange("mirror", !settings.mirror)}
              className="rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
            >
              Mirror: {settings.mirror ? "on" : "off"}
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-white/40">
            The Elgato Prompter mirrors its display automatically, so leave
            Mirror <strong>off</strong> — turning it on will double-flip and make
            the text unreadable through the glass. It&apos;s here only as an
            escape hatch. The panel is 1024&times;600; this popup opens at that
            size so what you tune is what you get.
          </p>
          <p className="text-[11px] leading-relaxed text-white/40">
            J / ↓ / Space advance · K / ↑ back · P play-pause (Beats: toggle
            descriptions) · R reset · ← / → change variant. Stream Deck:{" "}
            <code>localhost:5174/api/teleprompter-advance</code>, and{" "}
            <code>-back</code>, <code>-toggle-play</code>, <code>-reset</code>.
          </p>
        </div>
      )}

      <div className="flex items-center gap-1 rounded-full border border-fuchsia-400/50 bg-neutral-950/95 px-2 py-1.5 shadow-2xl backdrop-blur">
        {/* The source tab: a real control, because which document belongs on the
            glass is one of the questions this prototype exists to answer. */}
        <div className="flex overflow-hidden rounded-full bg-white/5">
          {SOURCES.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => onChange("source", source)}
              className={`px-3 py-1 text-xs capitalize transition-colors ${
                settings.source === source
                  ? "bg-fuchsia-500 text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {source}
            </button>
          ))}
        </div>

        {isScript && (
          <>
            <span className="mx-1 h-4 w-px bg-white/20" />
            <button
              type="button"
              onClick={() => cycleVariant(-1)}
              className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Previous variant"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1 text-xs text-white">
              {settings.variant} — {VARIANT_NAMES[settings.variant]}
            </span>
            <button
              type="button"
              onClick={() => cycleVariant(1)}
              className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Next variant"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        <span className="mx-1 h-4 w-px bg-white/20" />
        <span className="px-1 text-[11px] text-white/50">{props.status}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
          aria-label="Toggle prototype controls"
        >
          {open ? <X className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
