/**
 * THE CHAT CARD (GLOSSARY, spec #2551, #2669): a Shorts-only Overlay Kind
 * that shows one Chat Highlight, copied onto the Overlay (author into
 * `title`, text into `description`).
 *
 * Pure: which Chat Highlight a Chat Card defaults to. The CLI reads the rows;
 * this decides.
 */

/** A Chat Highlight as a Chat Card needs it, times on the recorder's clock. */
export type ChatCardSource = {
  id: string;
  author: string;
  text: string;
  shownAtMs: number;
  hiddenAtMs: number | null;
};

/**
 * The Chat Highlight showing at `atMs`: the LATEST one shown at or before it,
 * if it is not yet hidden then (`atMs < hiddenAtMs`, or `hiddenAtMs` null).
 * At most one shows, so a later one replaces any earlier, even one never given
 * a hide. Undefined when none is showing.
 */
export const chatHighlightAt = <H extends ChatCardSource>(
  highlights: ReadonlyArray<H>,
  atMs: number
): H | undefined => {
  const latest = [...highlights]
    .filter((h) => h.shownAtMs <= atMs)
    .sort((a, b) => a.shownAtMs - b.shownAtMs)
    .at(-1);
  if (!latest) return undefined;
  return latest.hiddenAtMs === null || atMs < latest.hiddenAtMs
    ? latest
    : undefined;
};
