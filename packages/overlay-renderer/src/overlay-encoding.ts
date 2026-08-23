/**
 * The single source of truth for how the overlay is encoded.
 *
 * ProRes 4444 + `yuva444p10le` is what gives the `.mov` an alpha channel, so
 * CVM can composite the overlay over the source video downstream. Both the
 * programmatic render (`src/render.ts`) and the Studio/CLI config
 * (`remotion.config.ts`) read these values — change them in one place only, and
 * re-check the composite step before touching them.
 */
export const OVERLAY_ENCODING = {
  codec: "prores",
  proResProfile: "4444",
  pixelFormat: "yuva444p10le",
  imageFormat: "png",
} as const;
