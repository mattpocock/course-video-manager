import {
  CHAT_CARD_PLACEMENT,
  type ChatCard,
} from "@cvm/overlay-renderer/props";
import type { ChatSpinCell } from "@cvm/core/features/videos/chat-card";
import { chatCardMotion } from "@cvm/core/features/videos/chat-highlight-motion";

/**
 * One Chat Card's renderer props: its copied author and text, its spin's
 * cells, its frame window, its motion frame by frame (the renderer cannot
 * import the domain's Chat Spin) and its placement. Built here once, so the
 * editor's preview and the Short's render (`vertical-overlay-props.ts`) can
 * never draw a Chat Card differently.
 */
export const chatCardInputProps = (
  card: {
    title: string;
    description: string;
    chatSpin: ChatSpinCell[] | null;
    disableEnterAnimation: boolean;
    disableExitAnimation: boolean;
  },
  frames: { startFrame: number; durationInFrames: number; fps: number }
): ChatCard => {
  const cells = card.chatSpin ?? [];
  return {
    author: card.title,
    text: card.description,
    cells,
    startFrame: frames.startFrame,
    durationInFrames: frames.durationInFrames,
    ...chatCardMotion({
      cellCount: cells.length + 1,
      fps: frames.fps,
      durationInFrames: frames.durationInFrames,
      disableEnterAnimation: card.disableEnterAnimation,
      disableExitAnimation: card.disableExitAnimation,
    }),
    ...CHAT_CARD_PLACEMENT,
  };
};
