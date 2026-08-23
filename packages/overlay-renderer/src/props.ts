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
});

/** Parsed props (all defaults applied) — what the composition receives. */
export type OverlayProps = z.infer<typeof overlayPropsSchema>;

/** Raw props as accepted from callers (defaults optional). */
export type OverlayPropsInput = z.input<typeof overlayPropsSchema>;

/** Parse and validate raw props, applying defaults. Throws on invalid input. */
export const parseOverlayProps = (input: unknown): OverlayProps =>
  overlayPropsSchema.parse(input);
