import type { CallToAction } from "@cvm/overlay-renderer/props";

/**
 * One Call to Action's renderer props: its headline (the Overlay's `title`),
 * its subline (`description`), its frame window and its Animation Toggles.
 * Built here once, as `chatCardInputProps` is, so the editor's preview and
 * the Short's render (`vertical-overlay-props.ts`) can never draw a Call to
 * Action differently.
 */
export const callToActionInputProps = (
  overlay: {
    title: string;
    description: string;
    disableEnterAnimation: boolean;
    disableExitAnimation: boolean;
  },
  frames: { startFrame: number; durationInFrames: number }
): CallToAction => ({
  title: overlay.title,
  description: overlay.description,
  startFrame: frames.startFrame,
  durationInFrames: frames.durationInFrames,
  disableEnterAnimation: overlay.disableEnterAnimation,
  disableExitAnimation: overlay.disableExitAnimation,
});
