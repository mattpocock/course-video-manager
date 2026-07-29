/**
 * PROTOTYPE — throwaway. Pixel-level fidelity sweep.
 *
 * For every lucide icon: rasterise (a) the source SVG exactly as lucide ships
 * it and (b) the transpiled PathBuilder output, in the same 24x24 viewBox with
 * the same stroke settings, through the same renderer. Diff the alpha channels.
 *
 * Same rasteriser on both sides, so any difference IS geometry error — this
 * isn't comparing two renderers.
 */

import {
  ICONS,
  ICON_NAMES,
} from "./icon-shape-util";
import {
  iconNodeToPathBuilder,
  iconNodeToSvgMarkup,
  LUCIDE_VIEWBOX,
} from "./lucide-to-path-builder";

export interface IconFidelity {
  name: string;
  /** pixels differing by more than the alpha threshold */
  diffPixels: number;
  /** pixels the source SVG actually inks */
  sourcePixels: number;
  /** diffPixels / sourcePixels */
  ratio: number;
  /** largest single-pixel alpha delta, 0..255 */
  maxDelta: number;
  error?: string;
}

const ALPHA_THRESHOLD = 32;

function svgToDataUrl(svg: string) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

async function rasterise(
  svg: string,
  px: number,
  ctx: CanvasRenderingContext2D,
): Promise<Uint8ClampedArray> {
  const img = new Image(px, px);
  img.src = svgToDataUrl(svg);
  await img.decode();
  ctx.clearRect(0, 0, px, px);
  ctx.drawImage(img, 0, 0, px, px);
  return ctx.getImageData(0, 0, px, px).data;
}

export function transpiledSvgMarkup(name: string, px: number) {
  const node = ICONS[name]!;
  const path = iconNodeToPathBuilder(node, LUCIDE_VIEWBOX);
  const filled = path.toD({ onlyFilled: true });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
    filled ? `<path fill="#000" stroke="none" d="${filled}" />` : ""
  }<path d="${path.toD()}" /></svg>`;
}

export function sourceSvgMarkup(name: string, px: number) {
  return iconNodeToSvgMarkup(ICONS[name]!, px).replace(
    'stroke="currentColor"',
    'stroke="#000"',
  );
}

export async function runFidelitySweep(opts?: {
  px?: number;
  names?: string[];
  onProgress?(done: number, total: number): void;
}): Promise<{
  px: number;
  total: number;
  perfect: number;
  errors: IconFidelity[];
  results: IconFidelity[];
}> {
  const px = opts?.px ?? 96;
  const names = opts?.names ?? ICON_NAMES;

  const a = document.createElement("canvas");
  const b = document.createElement("canvas");
  a.width = a.height = b.width = b.height = px;
  const actxA = a.getContext("2d", { willReadFrequently: true })!;
  const actxB = b.getContext("2d", { willReadFrequently: true })!;

  const results: IconFidelity[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    try {
      const srcData = await rasterise(sourceSvgMarkup(name, px), px, actxA);
      const outData = await rasterise(transpiledSvgMarkup(name, px), px, actxB);

      let diffPixels = 0;
      let sourcePixels = 0;
      let maxDelta = 0;
      for (let p = 3; p < srcData.length; p += 4) {
        const sa = srcData[p]!;
        const oa = outData[p]!;
        if (sa > ALPHA_THRESHOLD) sourcePixels++;
        const delta = Math.abs(sa - oa);
        if (delta > maxDelta) maxDelta = delta;
        if (delta > ALPHA_THRESHOLD) diffPixels++;
      }
      results.push({
        name,
        diffPixels,
        sourcePixels,
        ratio: sourcePixels ? diffPixels / sourcePixels : 0,
        maxDelta,
      });
    } catch (err) {
      results.push({
        name,
        diffPixels: -1,
        sourcePixels: 0,
        ratio: Infinity,
        maxDelta: 255,
        error: String(err),
      });
    }
    if (i % 25 === 0) {
      opts?.onProgress?.(i, names.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  opts?.onProgress?.(names.length, names.length);

  return {
    px,
    total: results.length,
    perfect: results.filter((r) => !r.error && r.diffPixels === 0).length,
    errors: results.filter((r) => r.error),
    results: results.sort((x, y) => y.ratio - x.ratio),
  };
}
