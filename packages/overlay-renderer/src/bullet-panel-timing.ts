/**
 * A Bullet Panel's timing, as arithmetic with no React in it.
 *
 * It sits here rather than inside `remotion/BulletPanel.tsx` so the one rule
 * that the panel and the CAMERA have to agree on — when each end of the
 * animation fires — is testable without a browser, a font loader or a
 * Remotion render. The component does nothing with these numbers but turn
 * them into an opacity and a translate.
 */

import { BULLET_PANEL_ANIMATION_IN_SECONDS } from "./props";

/** How many frames one ease takes, at the composition's frame rate. */
export const bulletPanelAnimationFrames = (fps: number): number =>
  Math.max(1, Math.round(BULLET_PANEL_ANIMATION_IN_SECONDS * fps));

/**
 * The frame the panel's EXIT begins on.
 *
 * An eased exit begins one ease before the window ends, so it has finished by
 * the last frame. A DISABLED exit begins at the window's end — not one ease
 * early. That is the whole point of the flag: `disableExitAnimation` also
 * zeroes the camera Transform's exit ease (`overlay-transform.ts`), so the
 * footage holds its shifted framing right to the final frame. A panel that
 * vanished an ease before that would leave the footage visibly pushed aside
 * for nothing on top of it — the exact desync the Animation Toggles exist to
 * make impossible.
 */
export const bulletPanelExitStartFrame = (params: {
  durationInFrames: number;
  animationFrames: number;
  disableExitAnimation: boolean;
}): number =>
  params.disableExitAnimation
    ? params.durationInFrames
    : params.durationInFrames - params.animationFrames;

/**
 * A 0 -> 1 ramp over `duration` frames from `startFrame`, before easing.
 *
 * `instant` is what the `disable*Animation` flags collapse it to: the value
 * still changes at exactly the same frame, it just gets there in one step.
 * That is why a disabled enter animation does NOT change a bullet's reveal
 * timing.
 */
export const bulletPanelRampProgress = (params: {
  frame: number;
  startFrame: number;
  duration: number;
  instant: boolean;
}): number => {
  if (params.instant) return params.frame >= params.startFrame ? 1 : 0;
  if (params.frame <= params.startFrame) return 0;
  if (params.frame >= params.startFrame + params.duration) return 1;
  return (params.frame - params.startFrame) / params.duration;
};
