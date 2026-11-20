---
status: accepted
---

# An Overlay Transform slides and never zooms

Decided on 2026-08-23 with the first Bullet Panel (#1585); recorded here from the header comment of `packages/core/features/videos/overlay-transform.ts`, its only record until now.

An **Overlay** whose content needs room, today only a **Bullet Panel**, moves the camera while it is on screen: an **Overlay Transform**. Decision: a Transform is a pure slide. The footage keeps its own scale to the pixel and travels sideways in frame for the Overlay's own window, then comes back when the Overlay goes. The source footage is never magnified. A presenter shot that grows when a panel arrives reads as a cut to a different framing; a shot that slides reads as the frame making room. So each end of a Transform is one number, how far right the footage sits as a fraction of the frame's width (`OverlayFraming` is `{ offsetX }`), with deliberately no scale, no vertical offset and no origin. Adding any of them would let a Transform do the thing it exists not to do.

Nobody authors a Transform. An Overlay carries no keyframes and `cvm overlay` has no flag for them: the move is looked up from the **Overlay Kind** (`OVERLAY_TRANSFORMS`, a `Record<OverlayKind, OverlayTransform | null>`), so adding a Bullet Panel is all it takes to get the panel and its camera move together, in sync, every time. A new Overlay Kind does not compile until someone says whether it moves the camera.

A Transform and a **Clip Zoom** are never applied to the same footage. A Clip Zoom is already cropped into the Clip by the time the Overlay pass sees it, so a Transform on top would act on a tightened shot, well past the framing either was tuned for. Reconciling the two is deliberately not attempted (#1579): `cvm overlay add` refuses an Overlay that moves the camera when its window lands on a zoomed Clip (`requireNoClipZoomUnderTransform`), so the mistake is a message rather than a bad render.

## Considered

- **Zooming toward the panel's free space.** Rejected: it reads as a cut to a new framing, not as the frame making room.
- **Keyframes authored per Overlay.** Rejected: the panel and the camera move would be two things to keep in step, and every Overlay would be a chance to get them out of step.
- **Composing a Transform with a Clip Zoom.** Rejected for now (#1579): refusing the authoring is cheaper than tuning a framing for both at once.
