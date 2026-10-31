import { AbsoluteFill } from "remotion";
import {
  CHAT_HIGHLIGHT_AUTHOR_TYPE,
  CHAT_HIGHLIGHT_GEOMETRY,
  CHAT_HIGHLIGHT_MAX_LINES,
  CHAT_HIGHLIGHT_MESSAGE_TYPE,
  type ChatHighlightCard as ChatHighlightCardContent,
} from "../src/chat-highlight-card";
import {
  ACCENT_BAR_WIDTH,
  COLORS,
  DESIGN_WIDTH,
  RADIUS,
  SHADOW,
} from "../src/definition-card-tokens";
import { fontFamily } from "./offline-dm-sans";

export type ChatHighlightCardProps = ChatHighlightCardContent & {
  /** The stream's frame width; every size scales by `frameWidth / 1920`. */
  frameWidth: number;
};

/**
 * The Chat Highlight card at rest: the author and their message on the
 * Definition Card's dark panel, with its amber bar, radii and shadow.
 *
 * It draws only the settled frame. The enter and exit motion is the card
 * feed's job, so this component has no animation at all.
 */
export const ChatHighlightCard = ({
  author,
  text,
  frameWidth,
}: ChatHighlightCardProps) => {
  const scale = frameWidth / DESIGN_WIDTH;
  const g = CHAT_HIGHLIGHT_GEOMETRY;

  return (
    <AbsoluteFill
      className="flex flex-col justify-end items-start"
      style={{ fontFamily, padding: g.shadowMargin * scale }}
    >
      {/* The shadow sits on a wrapper as a drop-shadow (see `SHADOW`). */}
      <div
        style={{
          filter: `drop-shadow(0 ${SHADOW.offsetY * scale}px ${
            SHADOW.blur * scale
          }px ${SHADOW.color})`,
        }}
      >
        <div
          className="relative flex flex-col overflow-hidden"
          style={{
            width: g.cardWidth * scale,
            background: COLORS.panel,
            gap: g.gap * scale,
            padding: g.padding * scale,
            paddingLeft: (g.padding + ACCENT_BAR_WIDTH) * scale,
            borderRadius: `${RADIUS.left * scale}px ${RADIUS.right * scale}px ${
              RADIUS.right * scale
            }px ${RADIUS.left * scale}px`,
          }}
        >
          <div
            className="absolute left-0 top-0 bottom-0"
            style={{
              width: ACCENT_BAR_WIDTH * scale,
              background: COLORS.accentBar,
            }}
          />
          <p
            style={{
              ...typeStyle(CHAT_HIGHLIGHT_AUTHOR_TYPE, scale),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {author}
          </p>
          <p
            style={{
              ...typeStyle(CHAT_HIGHLIGHT_MESSAGE_TYPE, scale),
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: CHAT_HIGHLIGHT_MAX_LINES,
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {text}
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const typeStyle = (
  type: {
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    color: string;
  },
  scale: number
) => ({
  fontSize: type.fontSize * scale,
  fontWeight: type.fontWeight,
  lineHeight: type.lineHeight,
  color: type.color,
});
