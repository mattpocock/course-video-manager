import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import type { ChatCard, ChatCardPose } from "../src/props";
import {
  CHAT_HIGHLIGHT_GEOMETRY,
  chatHighlightCanvasSize,
} from "../src/chat-highlight-card";
import { DESIGN_WIDTH } from "../src/definition-card-tokens";
import { loadFont } from "@remotion/google-fonts/DMSans";
import { ChatHighlightPanel } from "./ChatHighlightPanel";

// As the Definition Card loads it: the Overlay root may fetch its fonts.
const { fontFamily } = loadFont();

/**
 * A Short's Chat Cards, each in its own Sequence. At most one Overlay shows at
 * a time, so they never stack.
 */
export const ChatCards = ({ cards }: { cards: ChatCard[] }) => (
  <>
    {cards.map((card, index) => (
      <Sequence
        key={index}
        from={card.startFrame}
        durationInFrames={card.durationInFrames}
      >
        <ChatCardReel card={card} />
      </Sequence>
    ))}
  </>
);

/** The pose on `frame` of the card's own timeline. */
const poseAt = (card: ChatCard, frame: number): ChatCardPose => {
  if (frame < card.enter.length) return card.enter[frame]!;
  const exitStart = card.durationInFrames - card.exit.length;
  if (frame >= exitStart) return card.exit[frame - exitStart]!;
  return { opacity: 1, offsetY: 0, scroll: card.cells.length };
};

/**
 * The Chat Spin's reel: the Chat Highlight card, one cell per message with the
 * pick last, scrolled past a one-cell window. Every cell is the card's full
 * height, so the reel moves by whole cards; once landed it is the settled card.
 */
const ChatCardReel = ({ card }: { card: ChatCard }) => {
  const pose = poseAt(card, useCurrentFrame());
  const scale = card.width / CHAT_HIGHLIGHT_GEOMETRY.cardWidth;
  const margin = CHAT_HIGHLIGHT_GEOMETRY.shadowMargin * scale;
  const cellHeight = chatHighlightCanvasSize(DESIGN_WIDTH * scale).height;
  const strip = [...card.cells, { author: card.author, text: card.text }];

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: card.top - margin,
          height: cellHeight,
          overflow: "hidden",
          // Cells fade as they cross the window's edges, as on a reel, rather
          // than being cut by a hard line. Only the shadow margin fades.
          maskImage: `linear-gradient(to bottom, transparent, black ${margin}px, black calc(100% - ${margin}px), transparent)`,
          opacity: pose.opacity,
          transform: `translateY(${pose.offsetY * scale}px)`,
        }}
      >
        <div
          style={{ transform: `translateY(${-pose.scroll * cellHeight}px)` }}
        >
          {strip.map((cell, index) => (
            <div
              key={index}
              className="flex justify-center items-start"
              style={{ height: cellHeight, paddingTop: margin }}
            >
              <ChatHighlightPanel
                author={cell.author}
                text={cell.text}
                scale={scale}
              />
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
