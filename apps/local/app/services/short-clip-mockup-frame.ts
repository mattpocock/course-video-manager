import { pathToFileURL } from "node:url";
import {
  CANVASES,
  drawInstructions,
  type DrawInstruction,
} from "@/packages/scene-layout";

/**
 * THE PAGE A SHORT'S CLIP MOCKUP IS CAPTURED FROM.
 *
 * A Short's frame is a whole 1080x1920 picture, and the agent never draws the
 * whole of it. CVM draws the layout from the recorder's own Short layout
 * (`scene-layout`), so an agent cannot put code where the camera goes or
 * leave the advert's place covered. There are two scenes, named as the
 * recorder names them:
 *
 * - **Camera**: the opening moment, Matt to camera. A head icon on a blank
 *   frame, and a faint "advert" box in the bottom half, where the finished
 *   Short draws its call to action. The agent gives no picture for it.
 * - **Code**: the agent's page (or PNG) fills the screen square at the top,
 *   at exactly the screen's size, with the camera band and its head icon
 *   below. The page sits in an iframe, so nothing it does can reach outside
 *   the square.
 *
 * Pure: it returns the HTML and touches nothing. The caller writes the page
 * and captures it at `SHORT_FRAME` (`clip-mockup.batch.ts`).
 */

export type ShortScene = "camera" | "code";

/** A Short's frame: the Short canvas. */
export const SHORT_FRAME = CANVASES.short;

/**
 * The sizes the instructions are worked out from. Only the destination rects
 * are read, and those do not depend on the source size; these are the
 * recorder's own (a 1080x1080 Spacedesk screen, a 4K camera).
 */
const NOMINAL_SOURCES = {
  screen: { width: 1080, height: 1080 },
  camera: { width: 3840, height: 2160 },
} as const;

/** Where a scene draws one source on the Short canvas, in canvas pixels. */
export interface ShortRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const rectOf = (scene: "Camera" | "Code", source: "screen" | "camera") => {
  const drawn: DrawInstruction | undefined = drawInstructions(
    scene,
    NOMINAL_SOURCES,
    "short"
  ).find((d) => d.source === source);
  if (drawn === undefined) {
    throw new Error(`The Short ${scene} scene does not draw the ${source}`);
  }
  return { x: drawn.dx, y: drawn.dy, width: drawn.dw, height: drawn.dh };
};

/**
 * The rects a Short's frame is laid out in, read from the Short layout: the
 * Code scene's screen square and camera band, and the Camera scene's camera.
 */
export const SHORT_FRAME_RECTS = {
  codeScreen: rectOf("Code", "screen"),
  codeCamera: rectOf("Code", "camera"),
  camera: rectOf("Camera", "camera"),
} as const;

/** What a Short frame's page draws. */
export type ShortFramePage =
  | { readonly scene: "camera" }
  | {
      readonly scene: "code";
      /** The agent's page, drawn live in the screen square. */
      readonly source:
        | { readonly kind: "html"; readonly path: string }
        | { readonly kind: "image"; readonly path: string };
    };

/** lucide `user-round`, drawn in stroke: a head and shoulders. */
const HEAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;

const box = (r: ShortRect) =>
  `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;`;

const STYLE = `* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { position: relative; width: ${SHORT_FRAME.width}px; height: ${SHORT_FRAME.height}px;
  overflow: hidden; background: #0c0a09; font-family: Inter, system-ui, sans-serif; }
.region { position: absolute; overflow: hidden; }
.camera { background: #1c1917; color: #57534e; display: flex;
  align-items: center; justify-content: center; }
.head { display: block; }
.screen { background: #000; }
.screen iframe { display: block; width: 100%; height: 100%; border: 0; }
.screen img { display: block; width: 100%; height: 100%; object-fit: contain; }
.advert { position: absolute; border: 3px dashed rgba(214, 211, 209, 0.18);
  border-radius: 48px; color: rgba(214, 211, 209, 0.28); display: flex;
  align-items: center; justify-content: center; font-size: 40px;
  letter-spacing: 0.3em; text-transform: uppercase; }`;

/**
 * The Camera scene. The head sits in the top half, where a face sits in a
 * real one; the advert's box sits in the bottom half, as the finished Short's
 * call to action does (the overlay renderer gives it the bottom half, centred,
 * 96px in from each side).
 */
const cameraBody = () => {
  const r = SHORT_FRAME_RECTS.camera;
  const half = r.height / 2;
  const headSize = Math.round(r.width * 0.5);
  const advertWidth = r.width - 2 * 96;
  const advertHeight = Math.round(half * 0.4);
  return `<div class="region camera" style="${box(r)}align-items:flex-start;">
  <div class="head" style="width:${headSize}px;height:${headSize}px;margin-top:${Math.round(
    (half - headSize) / 2 + half * 0.15
  )}px;">${HEAD_ICON}</div>
  <div class="advert" style="left:96px;top:${Math.round(
    half + (half - advertHeight) / 2
  )}px;width:${advertWidth}px;height:${advertHeight}px;">advert</div>
</div>`;
};

/** The Code scene: the agent's square on top, the camera band below. */
const codeBody = (source: {
  readonly kind: "html" | "image";
  readonly path: string;
}) => {
  const screen = SHORT_FRAME_RECTS.codeScreen;
  const camera = SHORT_FRAME_RECTS.codeCamera;
  const href = pathToFileURL(source.path).href;
  const content =
    source.kind === "html"
      ? `<iframe src="${href}" scrolling="no"></iframe>`
      : `<img src="${href}" alt="">`;
  const headSize = Math.round(camera.height * 0.7);
  return `<div class="region screen" style="${box(screen)}">${content}</div>
<div class="region camera" style="${box(camera)}">
  <div class="head" style="width:${headSize}px;height:${headSize}px;">${HEAD_ICON}</div>
</div>`;
};

/** The whole page for one Short frame, to be captured at `SHORT_FRAME`. */
export const shortFramePageHtml = (page: ShortFramePage): string => {
  const body = page.scene === "camera" ? cameraBody() : codeBody(page.source);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${STYLE}
</style></head><body data-short-scene="${page.scene}">
${body}
</body></html>
`;
};
