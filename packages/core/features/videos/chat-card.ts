/**
 * THE CHAT CARD (GLOSSARY, spec #2551): a Shorts-only Overlay Kind that shows
 * one Chat Highlight, copied onto the Overlay (author into `title`, text into
 * `description`), opening with its Chat Spin: the same Recording Session's
 * other Chat Highlights fly past and it lands on the pick.
 *
 * Pure: which Chat Highlight a Chat Card defaults to, and which of the others
 * make its reel. The CLI reads the rows; this decides.
 */

/** One cell of a Chat Spin's reel: a message as its card shows it. */
export type ChatSpinCell = { author: string; text: string };

/** The most cells that fly past before the pick. */
export const CHAT_SPIN_MAX_CELLS = 8;

/** With fewer others than this there is no spin: the card just eases in. */
export const CHAT_SPIN_MIN_CELLS = 2;

/** A Chat Highlight as a Chat Card needs it, times on the recorder's clock. */
export type ChatCardSource = {
  id: string;
  author: string;
  text: string;
  shownAtMs: number;
  hiddenAtMs: number | null;
};

/**
 * The Chat Highlight at `atMs`: the one showing then
 * (`shownAtMs <= atMs < hiddenAtMs`, still showing when `hiddenAtMs` is null),
 * else the last one shown before it. Undefined when none was shown by then.
 */
export const chatHighlightAt = <H extends ChatCardSource>(
  highlights: ReadonlyArray<H>,
  atMs: number
): H | undefined => {
  const before = [...highlights]
    .filter((h) => h.shownAtMs <= atMs)
    .sort((a, b) => a.shownAtMs - b.shownAtMs);
  const showing = before.filter(
    (h) => h.hiddenAtMs === null || atMs < h.hiddenAtMs
  );
  return showing.at(-1) ?? before.at(-1);
};

/**
 * The Chat Spin's reel for `pick`: up to {@link CHAT_SPIN_MAX_CELLS} of the
 * session's OTHER Chat Highlights, the nearest to the pick in time, in the
 * order they were shown. `[]` (no spin) when fewer than
 * {@link CHAT_SPIN_MIN_CELLS} others exist. The pick itself is never a cell:
 * the card lands on it after the last one.
 */
export const chatSpinReel = (
  pick: ChatCardSource,
  session: ReadonlyArray<ChatCardSource>
): ChatSpinCell[] => {
  const others = session.filter((h) => h.id !== pick.id);
  if (others.length < CHAT_SPIN_MIN_CELLS) return [];
  return [...others]
    .sort(
      (a, b) =>
        Math.abs(a.shownAtMs - pick.shownAtMs) -
          Math.abs(b.shownAtMs - pick.shownAtMs) || a.shownAtMs - b.shownAtMs
    )
    .slice(0, CHAT_SPIN_MAX_CELLS)
    .sort((a, b) => a.shownAtMs - b.shownAtMs)
    .map(({ author, text }) => ({ author, text }));
};
