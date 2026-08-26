/**
 * **Effect Clip** — a Clip standing in for non-speech content (white noise, a
 * transition), inserted into the timeline by hand rather than captured. See
 * CONTEXT.md, "Effect Clip".
 *
 * There is no column for it: an Effect Clip is exactly a Clip carrying the
 * white-noise `scene` the editor stamps on one as it is created. That is the
 * whole of the definition, and it lives here so the editor and the database
 * cannot each hold their own copy of the string.
 *
 * What follows from it, and the reason the database needs to know: an Effect
 * Clip has no speech in it, so no **Transcription** will ever give it a
 * **Transcript Word**. It is not a Clip whose word timing is missing; it is a
 * Clip that has none to miss.
 */
export const EFFECT_CLIP_SCENE = "white noise";

/** Whether a Clip's `scene` marks it as an Effect Clip. */
export const isEffectClipScene = (scene: string | null | undefined): boolean =>
  scene === EFFECT_CLIP_SCENE;
