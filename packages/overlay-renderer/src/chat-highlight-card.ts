import { z } from "zod";
import {
  BODY_TYPE,
  COLORS,
  DESIGN_WIDTH,
  TITLE_TYPE,
} from "./definition-card-tokens";

/**
 * The Chat Highlight card: a Broadcast chat message shown on the Live Stream
 * picture, styled from the Definition Card's shared tokens.
 *
 * The card is rendered once per click as a still of its settled frame. It has
 * no animation of its own: the recorder service's card feed eases the still.
 *
 * Plain data only, so the card server's Node side can size the composition
 * without importing the React bundle graph.
 */

/** The Remotion composition id of the card, in the card server's own entry. */
export const CHAT_HIGHLIGHT_COMPOSITION_ID = "ChatHighlightCard";

/** The message text is clamped to this many lines, ending in an ellipsis. */
export const CHAT_HIGHLIGHT_MAX_LINES = 4;

/**
 * The author line: body size, so the message stays the main thing, in the
 * title's weight and the brand accent colour.
 */
export const CHAT_HIGHLIGHT_AUTHOR_TYPE = {
  fontSize: BODY_TYPE.fontSize,
  fontWeight: TITLE_TYPE.fontWeight,
  lineHeight: BODY_TYPE.lineHeight,
  color: COLORS.underline,
} as const;

/** The message: body type, in the title's white. */
export const CHAT_HIGHLIGHT_MESSAGE_TYPE = {
  ...BODY_TYPE,
  color: COLORS.title,
} as const;

/**
 * The card's geometry, in pixels against a 1920-wide frame (scale it by
 * `frameWidth / DESIGN_WIDTH`, as the Definition Card does).
 *
 * The still is a fixed-size transparent canvas, whatever the message length:
 * the stream overlays it at one fixed position, so its size can't change per
 * click. The card sits at the canvas's bottom left, with a margin all round
 * so the drop shadow is never cut off.
 */
export const CHAT_HIGHLIGHT_GEOMETRY = {
  cardWidth: 640,
  padding: 32,
  /** Between the author line and the message. */
  gap: 4,
  /** Room for the drop shadow (its blur and offset) on every side. */
  shadowMargin: 48,
} as const;

/** One request for a card still: who wrote the message, and what it says. */
export const chatHighlightCardSchema = z.object({
  author: z.string(),
  text: z.string(),
});

export type ChatHighlightCard = z.infer<typeof chatHighlightCardSchema>;

/** yuva420p halves the chroma planes, so the stream needs even dimensions. */
const even = (n: number) => Math.ceil(n / 2) * 2;

/**
 * The still's canvas size at a given frame width: tall enough for the author
 * line plus a message at its full {@link CHAT_HIGHLIGHT_MAX_LINES}.
 */
export const chatHighlightCanvasSize = (
  frameWidth: number
): { width: number; height: number } => {
  const scale = frameWidth / DESIGN_WIDTH;
  const g = CHAT_HIGHLIGHT_GEOMETRY;
  const lineHeight = (type: { fontSize: number; lineHeight: number }) =>
    type.fontSize * type.lineHeight;
  const cardHeight =
    g.padding * 2 +
    lineHeight(CHAT_HIGHLIGHT_AUTHOR_TYPE) +
    g.gap +
    lineHeight(CHAT_HIGHLIGHT_MESSAGE_TYPE) * CHAT_HIGHLIGHT_MAX_LINES;
  return {
    width: even((g.cardWidth + g.shadowMargin * 2) * scale),
    height: even((cardHeight + g.shadowMargin * 2) * scale),
  };
};
