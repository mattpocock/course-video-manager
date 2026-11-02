import type { ChatView } from "./chat-view";

/**
 * The pop-out chat as a presenter reads it (#2590): pure decisions about how
 * each row looks on the second screen, from the `ChatView` the Streaming tab
 * sends. The pop-out holds no state of its own beyond that view.
 */

/**
 * Author colours: light, high-contrast Tailwind hues on the dark glass, none
 * of them the Chat Highlight's amber. Full class names, so Tailwind sees them.
 */
export const AUTHOR_COLORS = [
  "text-sky-300",
  "text-emerald-300",
  "text-violet-300",
  "text-pink-300",
  "text-teal-300",
  "text-lime-300",
  "text-indigo-300",
  "text-rose-300",
  "text-cyan-300",
  "text-fuchsia-300",
] as const;

/** The same author always gets the same colour, in every window and reload. */
export const authorColor = (author: string): string => {
  let hash = 0;
  for (const ch of author) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length]!;
};

/** What a row says about the Chat Highlight, if anything. */
export type RowBadge = "on-stream" | "showing" | "hiding" | null;

export const rowBadge = (row: ChatView["rows"][number]): RowBadge => {
  if (row.pending) return row.highlighted ? "hiding" : "showing";
  return row.highlighted ? "on-stream" : null;
};

export const BADGE_LABELS: Record<Exclude<RowBadge, null>, string> = {
  "on-stream": "On stream",
  showing: "Showing…",
  hiding: "Hiding…",
};

/**
 * How far a row steps back from the newest: 0 is the newest, then 1, 2, and
 * every row older than that is 3. The pop-out dims by this, so the eye lands
 * on the bottom of the list.
 */
export const rowAge = (index: number, count: number): 0 | 1 | 2 | 3 =>
  Math.min(3, Math.max(0, count - 1 - index)) as 0 | 1 | 2 | 3;
