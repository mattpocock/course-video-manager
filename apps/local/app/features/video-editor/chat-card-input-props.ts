import {
  CHAT_CARD_PLACEMENT,
  type ChatCard,
} from "@cvm/overlay-renderer/props";
import {
  CHAT_HIGHLIGHT_GEOMETRY,
  chatHighlightCardHeight,
} from "@cvm/overlay-renderer/chat-highlight-card";
import { DESIGN_WIDTH } from "@cvm/overlay-renderer/definition-card-tokens";
import type { LayerRect } from "@cvm/core/features/videos/clip-layer";
import { boxesMeet } from "@cvm/core/features/videos/face-area";
import {
  CHAT_CARD_TRAVEL_PX,
  chatCardMotion,
} from "@cvm/core/features/videos/chat-highlight-motion";

/**
 * How a Short's Chat Card is drawn, in its Export Hash entry: bump it when its
 * look, its motion, its slots or the Face Area change. 2: one message, no
 * Chat Spin, placed clear of Matt's face (#2669).
 */
export const CHAT_CARD_VERSION = 2;

/**
 * The box a Chat Card may cover with its top at `top`, in Short pixels: the
 * card at its tallest (four lines of message), centred, and as low as its
 * entrance ever takes it.
 */
export const chatCardBox = (top: number): LayerRect => {
  const { width } = CHAT_CARD_PLACEMENT;
  const scale = width / CHAT_HIGHLIGHT_GEOMETRY.cardWidth;
  return {
    x: (1080 - width) / 2,
    y: top,
    w: width,
    h: chatHighlightCardHeight(DESIGN_WIDTH * scale) + CHAT_CARD_TRAVEL_PX,
  };
};

/**
 * THE CHAT CARD SLOT (#2669): where a Short's Chat Card is drawn, given the
 * Face Areas of every Clip it is drawn over. The top slot, unless its box
 * meets one of them; then the bottom slot, below the captions; null when
 * both do, and the card has nowhere to go that is clear of Matt's face.
 */
export const chatCardSlot = (
  faceAreas: ReadonlyArray<LayerRect>
): number | null => {
  const { top, bottom } = CHAT_CARD_PLACEMENT.slots;
  return (
    [top, bottom].find(
      (slot) => !faceAreas.some((area) => boxesMeet(chatCardBox(slot), area))
    ) ?? null
  );
};

/**
 * One Chat Card's renderer props: its copied author and text, its frame
 * window, its motion frame by frame (the renderer cannot import the domain's
 * motion) and its slot, clear of `faceAreas`. Null when no slot is clear.
 * Built here once, so the editor's preview and the Short's render
 * (`vertical-overlay-props.ts`) can never draw a Chat Card differently.
 */
export const chatCardInputProps = (
  card: {
    title: string;
    description: string;
    disableEnterAnimation: boolean;
    disableExitAnimation: boolean;
  },
  frames: { startFrame: number; durationInFrames: number; fps: number },
  faceAreas: ReadonlyArray<LayerRect>
): ChatCard | null => {
  const top = chatCardSlot(faceAreas);
  if (top === null) return null;
  return {
    author: card.title,
    text: card.description,
    startFrame: frames.startFrame,
    durationInFrames: frames.durationInFrames,
    ...chatCardMotion({
      fps: frames.fps,
      durationInFrames: frames.durationInFrames,
      disableEnterAnimation: card.disableEnterAnimation,
      disableExitAnimation: card.disableExitAnimation,
    }),
    top,
    width: CHAT_CARD_PLACEMENT.width,
  };
};
