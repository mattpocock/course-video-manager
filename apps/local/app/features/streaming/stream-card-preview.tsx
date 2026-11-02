import {
  CHAT_HIGHLIGHT_AUTHOR_TYPE,
  CHAT_HIGHLIGHT_GEOMETRY,
  CHAT_HIGHLIGHT_MAX_LINES,
  CHAT_HIGHLIGHT_MESSAGE_TYPE,
} from "@cvm/overlay-renderer/chat-highlight-card";
import {
  ACCENT_BAR_WIDTH,
  COLORS,
  DESIGN_WIDTH,
  FONT_FAMILY,
  RADIUS,
  SHADOW,
} from "@cvm/overlay-renderer/definition-card-tokens";
import { CHAT_HIGHLIGHT_TRAVEL_PX } from "@cvm/core/features/videos/chat-highlight-motion";
import { useLiveStream } from "./live-stream-context";
import { highlightOnPicture } from "./chat-highlight-reducer";

/**
 * A length on the 1920-wide stream, drawn at the picture's width: the box
 * this sits in is a size container, so `100cqw` is the picture's width.
 */
const px = (n: number) => `calc(${n} * 100cqw / ${DESIGN_WIDTH})`;

const typeStyle = (type: {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  color: string;
}) => ({
  fontSize: px(type.fontSize),
  fontWeight: type.fontWeight,
  lineHeight: type.lineHeight,
  color: type.color,
});

/**
 * The Chat Highlight on the Streaming tab's picture (#2558), where the stream
 * shows it: the card the stream draws (`ChatHighlightCard` in the overlay
 * renderer), drawn again here from the same tokens and geometry, settled at
 * the bottom left. The browser draws it over the recorder's preview, so the
 * recorder and the stream do no extra work. It shows once the card is on the
 * stream, without the stream's ease in and out.
 */
export const StreamCardPreview = () => {
  const { state } = useLiveStream();
  const message = highlightOnPicture(state);
  if (!message) return null;
  const g = CHAT_HIGHLIGHT_GEOMETRY;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg [container-type:size]"
      data-testid="stream-card-preview"
    >
      <div
        className="absolute"
        style={{
          left: px(g.shadowMargin),
          bottom: px(g.shadowMargin + CHAT_HIGHLIGHT_TRAVEL_PX),
          fontFamily: `"${FONT_FAMILY}", sans-serif`,
          filter: `drop-shadow(0 ${px(SHADOW.offsetY)} ${px(SHADOW.blur)} ${SHADOW.color})`,
        }}
      >
        <div
          className="relative flex flex-col overflow-hidden"
          style={{
            width: px(g.cardWidth),
            background: COLORS.panel,
            gap: px(g.gap),
            padding: px(g.padding),
            paddingLeft: px(g.padding + ACCENT_BAR_WIDTH),
            borderRadius: `${px(RADIUS.left)} ${px(RADIUS.right)} ${px(RADIUS.right)} ${px(RADIUS.left)}`,
          }}
        >
          <div
            className="absolute left-0 top-0 bottom-0"
            style={{
              width: px(ACCENT_BAR_WIDTH),
              background: COLORS.accentBar,
            }}
          />
          <p className="truncate" style={typeStyle(CHAT_HIGHLIGHT_AUTHOR_TYPE)}>
            {message.author}
          </p>
          <p
            style={{
              ...typeStyle(CHAT_HIGHLIGHT_MESSAGE_TYPE),
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: CHAT_HIGHLIGHT_MAX_LINES,
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {message.text}
          </p>
        </div>
      </div>
    </div>
  );
};
