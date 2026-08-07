/**
 * Clip Zoom — the single place the zoomed shot is decided.
 *
 * A Clip Zoom renders a Clip larger than frame, cropped in, so that a run of
 * face-only Camera clips has some visual change across the cuts. It is a
 * clip-level marker in exactly the sense `pauseType` is: an enum (not a
 * boolean) so it can gain more levels later, and a property the renderer acts
 * on — which is why it must reach the Export Hash (see export-hash.ts).
 *
 * Two consumers have to agree on the shot, or the editor preview lies about
 * what the Publish will ship:
 *
 *   - the preview, a CSS transform on the clip's <video> element
 *   - the export, an ffmpeg `crop` in the concat filter chain
 *
 * They agree because they are both formatted from {@link clipZoomRect} and
 * nothing else. The rect is fractional rather than pixel-valued, so it is
 * resolution-independent: filming at 1440 instead of 1080 needs no change
 * here. `clip-zoom.test.ts` pins the two formattings against the same
 * arithmetic, so drift needs someone to edit this file.
 */

export const CLIP_ZOOM_TYPES = ["none", "subtle"] as const;

export type ClipZoomType = (typeof CLIP_ZOOM_TYPES)[number];

export const DEFAULT_CLIP_ZOOM_TYPE: ClipZoomType = "none";

/**
 * The OBS scenes a Clip Zoom may be applied to: the ones that are just Matt's
 * face, where a cut to a slightly tighter shot reads as deliberate. Zooming a
 * `Code` scene would crop the code, which is the content.
 *
 * `TikTok Face` is the portrait profile's camera scene; `Camera` appears under
 * both profiles.
 */
export const ZOOMABLE_SCENES: readonly string[] = ["Camera", "TikTok Face"];

/**
 * A zoom expressed as fractions of the frame, in the same terms CSS uses:
 * `scale` is the magnification, and `originX`/`originY` are the fixed point
 * the magnification happens around (0.5/0.5 being dead centre).
 *
 * Both numbers stay fractional deliberately — a rect in source pixels would
 * need different arithmetic for a 1920x1080 Camera clip and a 1080x1920
 * TikTok Face clip, and would have to be rewritten the day the camera moves
 * to 1440.
 */
export type ClipZoomRect = {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
};

/**
 * 115% was picked by rendering candidates against real Camera footage: 108%
 * is invisible unless you flick between frames, and past ~120% the crop starts
 * eating the hand gestures that sit low in the shot.
 *
 * The vertical origin sits above centre (0.3, so 30% of the discarded height
 * comes off the top and 70% off the bottom) because the framing already puts
 * the head high with headroom to spare — a centred crop tightens the headroom
 * faster than it tightens anything worth keeping.
 *
 * Retuning either number is a one-line edit here. It is deliberately NOT
 * encoded in the enum's value names, which would put today's numbers into
 * every row and make retuning a migration.
 */
const ZOOM_RECTS: Record<ClipZoomType, ClipZoomRect | null> = {
  none: null,
  subtle: { scale: 1.15, originX: 0.5, originY: 0.3 },
};

/**
 * Coerce a raw `zoom_type` string (e.g. straight off the DB column) into a
 * known {@link ClipZoomType}. Anything unrecognised is treated as no zoom —
 * the reading that renders what the footage already looked like.
 */
export const resolveClipZoomType = (
  zoomType: string | null | undefined
): ClipZoomType =>
  (CLIP_ZOOM_TYPES as readonly string[]).includes(zoomType ?? "")
    ? (zoomType as ClipZoomType)
    : DEFAULT_CLIP_ZOOM_TYPE;

/**
 * The shot, or `null` for a clip that renders exactly as it was filmed.
 * Every consumer goes through here.
 */
export const clipZoomRect = (
  zoomType: string | null | undefined
): ClipZoomRect | null => ZOOM_RECTS[resolveClipZoomType(zoomType)];

/**
 * The preview half of the contract: CSS properties for the clip's <video>.
 * `null` when there is no zoom, so the element keeps its untouched styles
 * rather than carrying an identity transform.
 *
 * A `transform-origin` of (ox, oy) under `scale(s)` exposes the source region
 * starting at `ox * w * (1 - 1/s)` — which is precisely the ffmpeg crop offset
 * below. That identity is what makes the preview honest, and it is asserted in
 * the tests rather than left as a comment.
 */
export const clipZoomCssStyle = (
  zoomType: string | null | undefined
): { transform: string; transformOrigin: string } | null => {
  const rect = clipZoomRect(zoomType);
  if (!rect) return null;

  return {
    transform: `scale(${rect.scale})`,
    transformOrigin: `${rect.originX * 100}% ${rect.originY * 100}%`,
  };
};

/**
 * The export half: an ffmpeg `crop` filter, or `null` for no zoom.
 *
 * Written in ffmpeg's own `iw`/`ih` terms rather than resolved pixels so the
 * filter is correct for whatever the source happens to be. This crop belongs
 * BEFORE the normalising `scale` in the chain: cropping first means a 2560x1440
 * source is cut to 2226x1252 and then scaled DOWN to the 1920x1080 output, so
 * the zoom costs no sharpness at all. Cropping after the scale would throw the
 * surplus resolution away and then stretch what was left.
 */
export const clipZoomCropFilter = (
  zoomType: string | null | undefined
): string | null => {
  const rect = clipZoomRect(zoomType);
  if (!rect) return null;

  const { scale, originX, originY } = rect;
  return [
    `crop=iw/${scale}`,
    `ih/${scale}`,
    `(iw-iw/${scale})*${originX}`,
    `(ih-ih/${scale})*${originY}`,
  ].join(":");
};

/**
 * Why a Clip cannot be zoomed. `null` means it can.
 *
 * The two reasons are kept apart because they are different problems for
 * whoever hit the wall: a `Code` clip is one you should not be zooming, while
 * a scene-less clip is one filmed before CVM recorded scenes at all (there are
 * ~4,500 of them) and no amount of retrying will make it eligible.
 */
export type ClipZoomIneligibility =
  | { readonly reason: "no-recorded-scene" }
  | { readonly reason: "not-a-camera-scene"; readonly scene: string };

export const checkClipZoomEligibility = (
  scene: string | null | undefined
): ClipZoomIneligibility | null => {
  if (scene === null || scene === undefined || scene === "") {
    return { reason: "no-recorded-scene" };
  }
  if (!ZOOMABLE_SCENES.includes(scene)) {
    return { reason: "not-a-camera-scene", scene };
  }
  return null;
};

/**
 * The predicate the UI uses to decide whether to offer the affordance at all.
 * The service enforces the same rule, so a caller that never touches the UI
 * (the CLI, or the next one) inherits it rather than reimplementing it.
 */
export const canZoomClip = (scene: string | null | undefined): boolean =>
  checkClipZoomEligibility(scene) === null;

/** Human-facing text for a refusal, shared by every caller that has to say no. */
export const clipZoomIneligibilityMessage = (
  ineligibility: ClipZoomIneligibility
): string =>
  ineligibility.reason === "no-recorded-scene"
    ? "clip has no recorded scene, so it cannot be zoomed"
    : `clip zoom applies only to camera scenes ${JSON.stringify(
        ZOOMABLE_SCENES
      )} (this clip is ${JSON.stringify(ineligibility.scene)})`;
