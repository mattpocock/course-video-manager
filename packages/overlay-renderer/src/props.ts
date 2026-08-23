import { z } from "zod";

/**
 * The Remotion composition id the renderer selects. Lives here (not in the
 * Remotion source) so the Node render orchestration can reference it without
 * importing the React/CSS bundle graph.
 */
export const COMPOSITION_ID = "Overlay";

/**
 * The render contract for a CVM overlay — subtitles + CTA (the vertical Shorts
 * pipeline) and Definition Cards (the landscape course-video pipeline).
 *
 * Every invocation is driven entirely by these explicit props — there is no
 * `meta.json`-in-the-source-tree handshake like the deprecated monorepo used.
 * CVM builds this object and hands it to the renderer per short.
 */

/** One caption segment, timed in frames at the composition's `fps`. */
export const subtitleSchema = z.object({
  /** First frame the segment is visible on. */
  startFrame: z.number(),
  /** Frame the segment stops being visible on (exclusive). */
  endFrame: z.number(),
  /** The words shown for this segment. */
  text: z.string(),
});

export type Subtitle = z.infer<typeof subtitleSchema>;

/**
 * The call-to-action pill shown near the end of the overlay. Rendered as one of
 * the pre-made branded CTA images (kept as images so the look stays
 * pixel-identical to the current Remotion output). `null` = no CTA.
 */
export const ctaSchema = z.object({
  /** Which branded CTA image to show. */
  variant: z.enum(["ai", "typescript"]),
  /** How many frames the CTA stays on screen (it fades in and out). */
  durationInFrames: z.number(),
});

export type Cta = z.infer<typeof ctaSchema>;

/**
 * One on-screen term Definition Card: an AI-Hero-branded `title` +
 * `description` pair shown for a span of the overlay.
 *
 * A Definition Card is normally rendered as its own overlay clip, exactly as
 * long as the card itself — so `startFrame` defaults to `0` and
 * `durationInFrames` is usually the whole composition. The field is still
 * explicit so several cards (and subtitles) can share one composition.
 */
export const definitionCardSchema = z.object({
  /** The term being defined. */
  title: z.string(),
  /** The one- or two-line explanation shown under the term. */
  description: z.string(),
  /** First frame the card is visible on. Defaults to the overlay's start. */
  startFrame: z.number().default(0),
  /** How many frames the card stays on screen (it fades in and out). */
  durationInFrames: z.number(),
});

export type DefinitionCard = z.infer<typeof definitionCardSchema>;

/** Four is what fits the panel's width at a readable size. */
export const MAX_BULLET_PANEL_BULLETS = 4;

/**
 * How long one bullet takes to ease in, and how long the whole panel takes to
 * leave.
 *
 * It is the CAMERA's ease as well. The panel slides in as the presenter's face
 * moves right, and those are one move seen twice — a panel that has arrived
 * while the camera is still travelling is the one result nobody wants.
 *
 * This package cannot import the domain's copy (`packages/core`'s
 * `OVERLAY_TRANSFORM_EASE_IN_SECONDS`, which the exported `crop` and the
 * editor's preview are both formatted from), because the renderer must not
 * depend on the domain database. So the number is repeated here and held equal
 * by a test in `apps/local`, which depends on both. Change one and that test
 * fails; change neither by accident and it cannot happen at all.
 */
export const BULLET_PANEL_ANIMATION_IN_SECONDS = 0.8;

/** One bullet of a Bullet Panel: an icon, its line of text, and when it appears. */
export const bulletPanelBulletSchema = z.object({
  /** A lucide icon name, e.g. `"circle-check"`. Validated at authoring time. */
  icon: z.string(),
  /** The line of text shown beside the icon. */
  text: z.string(),
  /**
   * SECONDS after this panel's own start at which the bullet appears — not
   * frames, and not frames since the composition's start. It is authored
   * against the Overlay's own clock (`wordStartTime - overlayAt`), and the
   * panel is drawn inside a Sequence that starts where the Overlay does, so
   * the number arrives here needing no conversion at all.
   */
  revealAt: z.number(),
});

export type BulletPanelBullet = z.infer<typeof bulletPanelBulletSchema>;

/**
 * One Bullet Panel: a heading plus up to four icon bullets, drawn down the LEFT
 * of frame while the camera Transform shifts the footage right to clear room
 * for it. The side is not a prop — it is fixed, so the layout is the same every
 * time it is used.
 *
 * Each bullet eases in at its OWN `revealAt`, so the list keeps pace with what
 * is being said — except one authored at `0`, which arrives with the panel
 * rather than easing in on top of the panel's own arrival. The whole panel leaves in ONE un-staggered movement, so the
 * exit stays as quick with four bullets as with one.
 */
export const bulletPanelSchema = z.object({
  /** The panel's heading. */
  title: z.string(),
  /** The bullets, in display order. Their `revealAt`s ascend. */
  bullets: z.array(bulletPanelBulletSchema).max(MAX_BULLET_PANEL_BULLETS),
  /** First frame the panel is visible on. Defaults to the overlay's start. */
  startFrame: z.number().default(0),
  /** How many frames the panel stays on screen. */
  durationInFrames: z.number(),
  /**
   * Hard-cut in: the panel appears fully formed instead of easing in. Bullets
   * still appear at their own `revealAt` — the timing holds, only the motion
   * goes.
   */
  disableEnterAnimation: z.boolean().default(false),
  /** Hard-cut out: the panel vanishes instead of easing out. */
  disableExitAnimation: z.boolean().default(false),
});

export type BulletPanel = z.infer<typeof bulletPanelSchema>;

export const overlayPropsSchema = z.object({
  /** Overlay width in px. Defaults to the vertical 9:16 frame. */
  width: z.number().default(1080),
  /** Overlay height in px. Defaults to the vertical 9:16 frame. */
  height: z.number().default(1920),
  /** Frames per second the segment/CTA timings are expressed in. */
  fps: z.number().default(60),
  /** Total length of the overlay in frames. */
  durationInFrames: z.number(),
  /** Word-timed caption segments. Defaults to none. */
  subtitles: z.array(subtitleSchema).default([]),
  /** Optional call-to-action, or `null` for none. */
  cta: ctaSchema.nullable().default(null),
  /**
   * Term Definition Cards to draw. Defaults to none, so the vertical Shorts
   * pipeline keeps sending its existing props unchanged.
   */
  definitionCards: z.array(definitionCardSchema).default([]),
  /**
   * Bullet Panels to draw. Its own array rather than a branch of
   * `definitionCards`, because one composition draws every content-kind it is
   * given at once — and because defaulting to none leaves every existing
   * caller's props valid unchanged.
   */
  bulletPanels: z.array(bulletPanelSchema).default([]),
});

/** Parsed props (all defaults applied) — what the composition receives. */
export type OverlayProps = z.infer<typeof overlayPropsSchema>;

/** Raw props as accepted from callers (defaults optional). */
export type OverlayPropsInput = z.input<typeof overlayPropsSchema>;

/** Parse and validate raw props, applying defaults. Throws on invalid input. */
export const parseOverlayProps = (input: unknown): OverlayProps =>
  overlayPropsSchema.parse(input);
