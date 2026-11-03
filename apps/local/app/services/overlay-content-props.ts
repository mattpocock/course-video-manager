import {
  OVERLAY_RENDER_FPS,
  OVERLAY_RENDER_FRAME,
  type OverlayContent,
} from "./overlay-render-cache";

/**
 * The props one Overlay's content is rendered with.
 *
 * An Overlay's content is rendered as its own clip — exactly as long as the
 * Overlay itself, not as long as the video it will be composited onto — so the
 * composition's duration and the content's duration are the same number of
 * frames, and the content starts on frame 0. That is what makes the render
 * depend on the content alone, and so what makes it cacheable across every
 * video that shows it.
 *
 * Frame 0 is also what keeps the panel in sync with the camera. The composite
 * pass shifts this whole clip to the Overlay's start with `setpts` and gates it
 * to `[start, end]` with the same `enable=` expression the kind-derived crop
 * node carries, so a `startFrame` of anything but 0 would slide the panel off
 * the camera move it was authored against.
 *
 * The props are built structurally, as a plain object, rather than against
 * `@cvm/overlay-renderer`'s zod schema: the renderer is reached by spawning
 * `bin.mjs` precisely so Remotion's Chromium toolchain stays out of this app's
 * dependency graph, and the subprocess parses these props with that schema on
 * arrival. `overlay-content-render-props.test.ts` is what holds the two shapes
 * together.
 */
export const overlayRenderProps = (content: OverlayContent) => {
  const durationInFrames = Math.ceil(
    content.durationInSeconds * OVERLAY_RENDER_FPS
  );

  // Both arrays are always present, and one of them is always empty. The
  // renderer's composition draws every content-kind it is given, so "which kind
  // is this" is expressed by which array has the entry — the same shape the
  // vertical Shorts pipeline sends with `subtitles`/`chatCards`. Keeping the shape
  // uniform is also what keeps every caller of this function off a union.
  return {
    width: OVERLAY_RENDER_FRAME.width,
    height: OVERLAY_RENDER_FRAME.height,
    fps: OVERLAY_RENDER_FPS,
    durationInFrames,
    definitionCards:
      content.kind === "definitionCard"
        ? [
            {
              title: content.title,
              description: content.description,
              startFrame: 0,
              durationInFrames,
            },
          ]
        : [],
    bulletPanels:
      content.kind === "bulletPanel"
        ? [
            {
              title: content.title,
              // `revealAt` crosses this boundary in SECONDS, unconverted: the
              // panel is drawn inside a Sequence that starts where the Overlay
              // does, so the renderer reads it against the same clock the
              // authoring agent wrote it against.
              bullets: content.bullets.map((bullet) => ({
                icon: bullet.icon,
                text: bullet.text,
                revealAt: bullet.revealAt,
              })),
              startFrame: 0,
              durationInFrames,
              disableEnterAnimation: content.disableEnterAnimation,
              disableExitAnimation: content.disableExitAnimation,
            },
          ]
        : [],
  };
};

export type OverlayContentProps = ReturnType<typeof overlayRenderProps>;
