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
  RADIUS,
  SHADOW,
} from "../src/definition-card-tokens";

/**
 * The card itself, at `scale` (1 = its size on a 1920-wide frame): the panel
 * with its drop shadow, and nothing around it. The Live Stream's still and a
 * Short's Chat Card both draw this. It loads no font: each composition that
 * draws it sets DM Sans its own way (bundled for the card server, which must
 * render offline; Google Fonts for the Overlay root).
 */
export const ChatHighlightPanel = ({
  author,
  text,
  scale,
}: ChatHighlightCardContent & { scale: number }) => {
  const g = CHAT_HIGHLIGHT_GEOMETRY;
  // The shadow sits on a wrapper as a drop-shadow (see `SHADOW`).
  return (
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
