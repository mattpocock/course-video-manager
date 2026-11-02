import { AbsoluteFill } from "remotion";
import {
  CHAT_HIGHLIGHT_GEOMETRY,
  type ChatHighlightCard as ChatHighlightCardContent,
} from "../src/chat-highlight-card";
import { DESIGN_WIDTH } from "../src/definition-card-tokens";
import { ChatHighlightPanel } from "./ChatHighlightPanel";
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
      <ChatHighlightPanel author={author} text={text} scale={scale} />
    </AbsoluteFill>
  );
};
