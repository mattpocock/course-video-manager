/**
 * This config only applies to the Remotion Studio / CLI (`npm run studio`).
 * The programmatic render path in `src/render.ts` passes these same options
 * directly to `@remotion/renderer` (the config file does not apply there).
 *
 * The transparency settings (prores 4444 + yuva444p10le) are what make the
 * overlay render with an alpha channel — do not change them without re-checking
 * the composite step downstream.
 */
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";
import { OVERLAY_ENCODING } from "./src/overlay-encoding";

Config.setVideoImageFormat(OVERLAY_ENCODING.imageFormat);
Config.setPixelFormat(OVERLAY_ENCODING.pixelFormat);
Config.setCodec(OVERLAY_ENCODING.codec);
Config.setProResProfile(OVERLAY_ENCODING.proResProfile);

Config.overrideWebpackConfig(enableTailwind);
