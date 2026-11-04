/**
 * Splitting one Clip into two adjacent Clips at a moment of its footage
 * (`cvm clip split`, #2670): where the cut goes, and what each side keeps.
 *
 * The cut snaps to a word boundary, so no Transcript Word is cut in half: a
 * moment inside a word moves to that word's nearer edge, and one in the
 * silence between two words stays put. Each word then goes to exactly one
 * side, and the text is split at the same word.
 *
 * Pure: no Effect, no DB. The transaction that writes a split is
 * db-clip-split.server.ts.
 */

import type { ClipLayerSpec } from "./clip-layer.js";
import type { ClipRange } from "./retime-cascade.js";

/** Where to split: a moment on the Clip's source clock, or before word `index`. */
export type ClipSplitAt =
  | { readonly kind: "source"; readonly seconds: number }
  | { readonly kind: "word"; readonly index: number };

/** A Clip-relative spoken word. */
export interface SplitWord {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** One side of a split: its text and its words, Clip-relative to that side. */
export interface ClipSplitSide<W extends SplitWord> {
  readonly text: string;
  readonly words: W[];
}

export interface ClipSplitPlan<W extends SplitWord> {
  /** The cut, Clip-relative seconds: the left side's length. */
  readonly cut: number;
  readonly left: ClipSplitSide<W>;
  readonly right: ClipSplitSide<W>;
}

const letters = (text: string) => text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

/** The boundary before word `index`: midway through the silence before it. */
const boundaryBefore = (words: readonly SplitWord[], index: number) => {
  const previousEnd = words[index - 1]!.end;
  const start = words[index]!.start;
  return previousEnd < start ? (previousEnd + start) / 2 : start;
};

/** The cut a moment snaps to: a word's nearer edge if it is inside one. */
const snapToWordEdge = (words: readonly SplitWord[], at: number) => {
  const inside = words.find((word) => word.start < at && at < word.end);
  if (!inside) return at;
  return at - inside.start <= inside.end - at ? inside.start : inside.end;
};

/** Split `text` after `count` of its whitespace tokens. */
const splitTokens = (text: string, count: number) => {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  return {
    left: tokens.slice(0, count).join(" "),
    right: tokens.slice(count).join(" "),
  };
};

/** How many tokens hold the share of the letters nearest `fraction`. */
const tokensForLetterShare = (text: string, fraction: number) => {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  const target = fraction * letters(text);
  let best = 0;
  let seen = 0;
  for (const [index, token] of tokens.entries()) {
    seen += letters(token);
    const bestSeen = letters(tokens.slice(0, best).join(""));
    if (Math.abs(seen - target) < Math.abs(bestSeen - target)) best = index + 1;
  }
  return best;
};

/**
 * Where a Clip splits and what each side keeps, or why it cannot.
 *
 * The text is split at the same word as the words when the Clip's tokens line
 * up with its words (an Edit Transcript keeps them so), else each side's text
 * is its words' own. A Clip with no words is cut where asked and its text
 * shared out by letter count, the fallback a Short's subtitles use.
 */
export const planClipSplit = <W extends SplitWord>(
  clip: ClipRange & { readonly text: string },
  words: readonly W[],
  at: ClipSplitAt,
  options: { readonly minimumSeconds?: number } = {}
): ClipSplitPlan<W> | { readonly problem: string } => {
  const duration = clip.sourceEndTime - clip.sourceStartTime;
  const ordered = [...words].sort((a, b) => a.start - b.start);

  let cut: number;
  if (at.kind === "word") {
    if (
      !Number.isInteger(at.index) ||
      at.index < 1 ||
      at.index >= ordered.length
    ) {
      return {
        problem:
          ordered.length < 2
            ? `the clip has ${ordered.length} Transcript Words: a word split needs at least 2`
            : `word ${at.index} cannot start the right side: pick 1 to ${ordered.length - 1}`,
      };
    }
    cut = boundaryBefore(ordered, at.index);
  } else {
    cut = snapToWordEdge(ordered, at.seconds - clip.sourceStartTime);
  }
  if (!(cut > 0 && cut < duration)) {
    return {
      problem:
        `the split must fall inside the clip (${clip.sourceStartTime} to ` +
        `${clip.sourceEndTime}, source seconds) and leave both sides some footage`,
    };
  }
  const minimum = options.minimumSeconds ?? 0;
  if (cut < minimum || duration - cut < minimum) {
    return {
      problem:
        `the split at ${clip.sourceStartTime + cut} (source seconds, snapped to a ` +
        `word edge) leaves a side shorter than the ${minimum}s minimum clip length`,
    };
  }

  const leftWords = ordered.filter((word) => word.start < cut);
  const rightWords = ordered
    .filter((word) => word.start >= cut)
    .map((word) => ({ ...word, start: word.start - cut, end: word.end - cut }));
  const tokenCount = clip.text.split(/\s+/).filter((t) => t.length > 0).length;

  const text =
    ordered.length === 0
      ? splitTokens(clip.text, tokensForLetterShare(clip.text, cut / duration))
      : tokenCount === ordered.length
        ? splitTokens(clip.text, leftWords.length)
        : {
            left: leftWords.map((word) => word.text).join(" "),
            right: rightWords.map((word) => word.text).join(" "),
          };

  return {
    cut,
    left: {
      text: text.left,
      words: leftWords.map((word) => ({
        ...word,
        end: Math.min(word.end, cut),
      })),
    },
    right: { text: text.right, words: rightWords },
  };
};

/**
 * Each side's Layers. A whole-Clip Layer goes to both, a Footage Layer of a
 * file starting `cut` later on the right so it shows the same Footage at the
 * same moment. A span goes to the side(s) it covers, trimmed at the cut. No
 * Layers stored (an untouched Clip) stays none on both. A side its spans leave
 * with no Layer at all cannot be a Clip, and is refused.
 */
export const splitClipLayers = (
  layers: readonly ClipLayerSpec[],
  cut: number
):
  | { readonly left: ClipLayerSpec[]; readonly right: ClipLayerSpec[] }
  | { readonly problem: string } => {
  const left: ClipLayerSpec[] = [];
  const right: ClipLayerSpec[] = [];
  for (const layer of layers) {
    if (layer.kind === "scene" || layer.span === null) {
      left.push(layer);
      right.push(
        layer.kind === "footage" && layer.source.kind === "file"
          ? {
              ...layer,
              source: { ...layer.source, start: layer.source.start + cut },
            }
          : layer
      );
      continue;
    }
    const { at, duration } = layer.span;
    if (at < cut) {
      left.push({
        ...layer,
        span: { at, duration: Math.min(duration, cut - at) },
      });
    }
    if (at + duration > cut) {
      const head = Math.max(cut - at, 0);
      right.push({
        ...layer,
        source:
          layer.source.kind === "file"
            ? { ...layer.source, start: layer.source.start + head }
            : layer.source,
        span: { at: Math.max(at - cut, 0), duration: duration - head },
      });
    }
  }
  if (layers.length > 0 && (left.length === 0 || right.length === 0)) {
    return {
      problem:
        `the ${left.length === 0 ? "left" : "right"} side would have no Layer: ` +
        "its Footage Layers' spans all fall on the other side",
    };
  }
  return { left, right };
};
