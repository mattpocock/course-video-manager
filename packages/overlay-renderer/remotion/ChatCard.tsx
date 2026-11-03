import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import type { ChatCard, ChatCardPose } from "../src/props";
import { CHAT_HIGHLIGHT_GEOMETRY } from "../src/chat-highlight-card";
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
        <ChatCardFrame card={card} />
      </Sequence>
    ))}
  </>
);

/** The pose on `frame` of the card's own timeline. */
const poseAt = (card: ChatCard, frame: number): ChatCardPose => {
  if (frame < card.enter.length) return card.enter[frame]!;
  const exitStart = card.durationInFrames - card.exit.length;
  if (frame >= exitStart) return card.exit[frame - exitStart]!;
  return { opacity: 1, offsetY: 0 };
};

/**
 * One chat message, as the Chat Highlight card, centred with its top `top`
 * px down, `offsetY` px lower while it fades in or out.
 */
const ChatCardFrame = ({ card }: { card: ChatCard }) => {
  const pose = poseAt(card, useCurrentFrame());
  const scale = card.width / CHAT_HIGHLIGHT_GEOMETRY.cardWidth;
  return (
    <AbsoluteFill style={{ fontFamily }}>
      <div
        className="absolute left-0 right-0 flex justify-center"
        style={{
          top: card.top,
          opacity: pose.opacity,
          transform: `translateY(${pose.offsetY}px)`,
        }}
      >
        <ChatHighlightPanel
          author={card.author}
          text={card.text}
          scale={scale}
        />
      </div>
    </AbsoluteFill>
  );
};
