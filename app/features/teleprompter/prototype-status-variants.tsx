/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * Three structurally different answers to "show me the state of the recording
 * session on the glass". They disagree about the fundamental encoding, not
 * about colour:
 *
 *   A — digits. The literal reading of the brief: short-form numbers.
 *   B — pips. No numbers at all; one mark per clip, read as a shape.
 *   C — words. No counts; a verdict in language.
 *
 * All three obey the standing rules for this surface, established in #1435 and
 * in the commits that stripped the beats view's 1/N counter: nothing animates,
 * nothing reflows, and they sit directly under the capture dot so there is a
 * single glance target rather than two.
 */
import { AlertTriangleIcon } from "lucide-react";
import { useRef } from "react";
import type { CaptureStatus, SessionCounts } from "@/lib/teleprompter-protocol";
import { TYPE } from "./teleprompter-settings";

export const VARIANTS = ["A", "B", "C"] as const;
export type Variant = (typeof VARIANTS)[number];

export const VARIANT_NAMES: Record<Variant, string> = {
  A: "Digits",
  B: "Pips",
  C: "Words",
};

/** Under the capture dot: top-4 (1rem) + size-14 (3.5rem) + a gap. */
const ANCHOR = "pointer-events-none absolute left-4 top-20 z-40 select-none";

const AMBER = "var(--color-amber-400)";
const QUIET = "var(--color-neutral-600)";

const face: React.CSSProperties = {
  fontFamily: TYPE.fontFamily,
  // Digits that don't change width as they tick, so nothing shuffles sideways.
  fontVariantNumeric: "tabular-nums",
  // Light, for the same reason the body type is light: heavy small glyphs bloom
  // through beam-splitter glass and the counters fill in.
  fontWeight: 300,
  letterSpacing: "0.02em",
};

// ---------------------------------------------------------------------------
// Q6 — when the display is allowed to change
// ---------------------------------------------------------------------------

export function isSpeaking(capture: CaptureStatus): boolean {
  return (
    capture === "speaking-detected" ||
    capture === "long-enough-speaking-for-clip-detected"
  );
}

/**
 * Q6(b): hold the last value taken while he wasn't talking, so the numbers
 * never move mid-sentence. Toggleable so live vs held can be felt back to back.
 */
export function useHeldCounts(
  counts: SessionCounts,
  capture: CaptureStatus,
  frozen: boolean
): SessionCounts {
  const held = useRef(counts);
  if (!frozen || !isSpeaking(capture)) held.current = counts;
  return held.current;
}

// ---------------------------------------------------------------------------
// A — Digits
// ---------------------------------------------------------------------------

export function VariantA(props: { counts: SessionCounts }) {
  const { pending, settled, orphaned } = props.counts;

  return (
    <div className={ANCHOR} style={face}>
      <div className="flex items-baseline gap-5">
        <Digit value={pending} label="waiting" dim={pending === 0} />
        <Digit value={settled} label="clips" dim={settled === 0} />
      </div>

      {orphaned > 0 && (
        <div
          className="mt-3 flex items-center gap-2"
          style={{ color: AMBER, ...face }}
        >
          <AlertTriangleIcon className="size-5" />
          <span style={{ fontSize: 22 }}>{orphaned} lost</span>
        </div>
      )}
    </div>
  );
}

function Digit(props: { value: number; label: string; dim: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span style={{ fontSize: 34, color: props.dim ? QUIET : TYPE.color }}>
        {props.value}
      </span>
      <span
        style={{
          fontSize: 13,
          color: props.dim ? "var(--color-neutral-700)" : TYPE.cueColor,
        }}
      >
        {props.label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B — Pips
// ---------------------------------------------------------------------------

/**
 * Beyond this a row of marks stops being countable at a glance and starts being
 * wallpaper — which matters here, because the production numbers say a session
 * runs 30-60 clips and can reach 270.
 */
const MAX_PIPS = 24;
const PER_ROW = 8;

export function VariantB(props: { counts: SessionCounts }) {
  const { pending, settled, orphaned } = props.counts;

  // Oldest first: settled, then the ones still in the air.
  const marks: ("settled" | "orphaned" | "pending")[] = [
    ...Array<"settled">(settled).fill("settled"),
    ...Array<"orphaned">(orphaned).fill("orphaned"),
    ...Array<"pending">(pending).fill("pending"),
  ];

  const overflow = Math.max(0, marks.length - MAX_PIPS);
  const shown = marks.slice(-MAX_PIPS);

  const rows: (typeof shown)[] = [];
  for (let i = 0; i < shown.length; i += PER_ROW) {
    rows.push(shown.slice(i, i + PER_ROW));
  }

  return (
    <div className={ANCHOR}>
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            {row.map((mark, j) => (
              <Pip key={`${i}-${j}`} mark={mark} />
            ))}
          </div>
        ))}
      </div>

      {overflow > 0 && (
        <div
          className="mt-2.5"
          style={{ ...face, fontSize: 13, color: TYPE.cueColor }}
        >
          +{overflow} before
        </div>
      )}
    </div>
  );
}

function Pip(props: { mark: "settled" | "orphaned" | "pending" }) {
  if (props.mark === "orphaned") {
    // A different *shape*, not just a different colour — the one state that
    // needs to survive being seen out of the corner of an eye.
    return <div className="size-3.5 rotate-45" style={{ background: AMBER }} />;
  }
  if (props.mark === "pending") {
    return (
      <div
        className="size-3.5 rounded-full border"
        style={{ borderColor: "var(--color-neutral-500)" }}
      />
    );
  }
  return (
    <div
      className="size-3.5 rounded-full"
      style={{ background: TYPE.color, opacity: 0.85 }}
    />
  );
}

// ---------------------------------------------------------------------------
// C — Words
// ---------------------------------------------------------------------------

export function VariantC(props: { counts: SessionCounts }) {
  const { pending, orphaned } = props.counts;

  return (
    <div className={ANCHOR} style={{ ...face, maxWidth: "18ch" }}>
      {orphaned > 0 && (
        <div
          className="mb-2 flex items-center gap-2"
          style={{ color: AMBER, fontSize: 24 }}
        >
          <AlertTriangleIcon className="size-6" />
          <span>
            {orphaned === 1 ? "a clip was lost" : `${orphaned} clips lost`}
          </span>
        </div>
      )}

      <div style={{ fontSize: 24, color: pending === 0 ? QUIET : TYPE.color }}>
        {pending === 0
          ? "all clips landed"
          : pending === 1
            ? "1 clip landing"
            : `${pending} clips landing`}
      </div>
    </div>
  );
}

export function SessionStatus(props: {
  variant: Variant;
  counts: SessionCounts;
}) {
  if (props.variant === "A") return <VariantA counts={props.counts} />;
  if (props.variant === "B") return <VariantB counts={props.counts} />;
  return <VariantC counts={props.counts} />;
}
