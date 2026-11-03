import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { OVERLAY_ENCODING } from "./overlay-encoding";
import {
  COMPOSITION_ID,
  overlayPropsSchema,
  type OverlayProps,
  type OverlayPropsInput,
} from "./props";

const packageRoot = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const entryPoint = path.join(packageRoot, "remotion", "index.ts");
const publicDir = path.join(packageRoot, "public");

export interface RenderOptions {
  /** Where to write the overlay. Use a `.mov` extension (ProRes 4444). */
  outputLocation: string;
  /** Optional 0..1 progress callback for long renders. */
  onProgress?: (progress: number) => void;
  /**
   * Reuse a bundle produced by {@link bundleOverlayRenderer}. When omitted, a
   * fresh bundle is built for this render (slower, but self-contained).
   */
  serveUrl?: string;
}

export interface RenderResult {
  outputLocation: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

/**
 * Bundle the Remotion project once so multiple renders can share it. Returns a
 * `serveUrl` to pass back into {@link renderOverlay}.
 */
const bundleOverlayRenderer = (): Promise<string> =>
  bundle({
    entryPoint,
    webpackOverride: enableTailwind,
    publicDir,
  });

/**
 * Render an overlay — subtitles, Calls to Action and/or Definition Cards — to a
 * transparent ProRes 4444 `.mov`.
 *
 * The overlay carries an alpha channel (pixel format `yuva444p10le`) so CVM can
 * composite it over the source video downstream. Rendering runs entirely
 * locally via Chromium — there is no AWS/Lambda path.
 */
export const renderOverlay = async (
  input: OverlayProps | OverlayPropsInput,
  options: RenderOptions
): Promise<RenderResult> => {
  const props = overlayPropsSchema.parse(input);
  const serveUrl = options.serveUrl ?? (await bundleOverlayRenderer());

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: props,
  });

  await renderMedia({
    composition,
    serveUrl,
    ...OVERLAY_ENCODING,
    inputProps: props,
    outputLocation: options.outputLocation,
    onProgress: options.onProgress
      ? ({ progress }) => options.onProgress!(progress)
      : undefined,
  });

  return {
    outputLocation: options.outputLocation,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  };
};

/**
 * Render ONE frame of the same composition {@link renderOverlay} renders, as a
 * transparent PNG: `cvm clip frame` composes it over the Clip's picture, so a
 * checked frame is drawn by the very code the Short's export is.
 */
export const renderOverlayFrame = async (
  input: OverlayProps | OverlayPropsInput,
  options: { frame: number; outputLocation: string; serveUrl?: string }
): Promise<RenderResult> => {
  const props = overlayPropsSchema.parse(input);
  const serveUrl = options.serveUrl ?? (await bundleOverlayRenderer());
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: props,
  });
  await renderStill({
    composition,
    serveUrl,
    inputProps: props,
    frame: options.frame,
    imageFormat: "png",
    output: options.outputLocation,
  });
  return {
    outputLocation: options.outputLocation,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  };
};

export {
  overlayPropsSchema,
  parseOverlayProps,
  subtitleSchema,
  callToActionSchema,
  definitionCardSchema,
  bulletPanelSchema,
  bulletPanelBulletSchema,
} from "./props";
export type {
  OverlayProps,
  OverlayPropsInput,
  Subtitle,
  CallToAction,
  DefinitionCard,
  BulletPanel,
  BulletPanelBullet,
} from "./props";
