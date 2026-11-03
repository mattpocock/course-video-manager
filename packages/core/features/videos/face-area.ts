import type { LayerRect } from "./clip-layer.js";

/**
 * THE FACE AREA (GLOSSARY, #2669): where Matt's face can be in his camera's
 * frame, as fractions of it. The camera's framing is fixed (the Short
 * layout's camera crops are cut to it), so one fraction holds for every
 * Recording Session. On the 2026-11-03 stream's frames his head ran from
 * about 0.07 to 0.46 down and 0.39 to 0.56 across: this leaves room for
 * him to lean and gesture.
 *
 * Bump `CHAT_CARD_VERSION` (export-hash) when it changes: it moves where a
 * Short's Chat Card is drawn.
 */
export const FACE_AREA: LayerRect = { x: 0.3, y: 0, w: 0.4, h: 0.55 };

/**
 * The Face Area as drawn by one camera picture: the part of it inside
 * `crop` (fractions of the camera's frame), scaled into `place` (pixels of
 * the Video's frame). Null when the crop leaves the face out.
 */
export const faceAreaDrawn = (
  crop: LayerRect,
  place: LayerRect
): LayerRect | null => {
  const x0 = Math.max(FACE_AREA.x, crop.x);
  const y0 = Math.max(FACE_AREA.y, crop.y);
  const x1 = Math.min(FACE_AREA.x + FACE_AREA.w, crop.x + crop.w);
  const y1 = Math.min(FACE_AREA.y + FACE_AREA.h, crop.y + crop.h);
  if (x1 <= x0 || y1 <= y0) return null;
  const px = (x: number) => place.x + ((x - crop.x) / crop.w) * place.w;
  const py = (y: number) => place.y + ((y - crop.y) / crop.h) * place.h;
  return { x: px(x0), y: py(y0), w: px(x1) - px(x0), h: py(y1) - py(y0) };
};

/** Whether two boxes share any area (touching edges do not). */
export const boxesMeet = (a: LayerRect, b: LayerRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
