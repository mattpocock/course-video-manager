/**
 * The rubric both passes of the screenshot judge share.
 *
 * These are screencasts: every frame is the screen plus a webcam overlay of
 * Matt in the corner. A frame has to work on both counts, so the rubric is
 * applied to the whole uncropped frame — the strongest positive signal is a
 * *relationship* between the two (Matt highlighting the thing he is talking
 * about), which cropping either half would destroy.
 */
export const SCREENSHOT_RUBRIC = `
You are choosing a single frame from a screencast to use as a screenshot in a written article.

The frame has two halves and must work on both:

**The screen.** It should show what the alt text describes, fully and readably:
- The thing described is on screen, in full, not scrolled half out of view.
- Any output has finished arriving. Streaming AI output, a spinner, a progress
  bar, a partially-rendered page or a half-run command are all disqualifying —
  the article wants the finished state, even though most of the clip shows it
  arriving.
- No half-typed lines, no autocomplete or IntelliSense popup covering the code,
  no transient toast or notification, not mid-scroll or mid-animation.

**Matt, in the webcam overlay.** He should not look ridiculous:
- Not mid-blink, not mouth-open mid-word, not caught mid-gesture or blurred.
- A neutral or engaged expression is fine. This is a tiebreak, not the main
  criterion — but a frame where he looks foolish is not usable however good
  the screen is.

**The strongest positive signal** is Matt actively drawing attention to the
thing the alt text describes: text selected/highlighted on screen, or the
cursor resting on the line being discussed. Prefer such frames strongly.

Judge only what you can actually see. Do not assume a frame is good because it
sits at a plausible moment in the transcript.
`.trim();

export interface ScreenshotJudgeContext {
  readonly alt: string;
  readonly clipTexts: {
    index: number;
    isNamed: boolean;
    text: string | null;
  }[];
  readonly surroundingText: string;
}

/** The shared preamble describing what this particular screenshot is for. */
export function buildScreenshotJudgeContext(
  ctx: ScreenshotJudgeContext
): string {
  const transcript = ctx.clipTexts
    .map(
      (c) =>
        `[clip ${c.index}]${c.isNamed ? " (the clip the writer named)" : ""} ${
          c.text ?? "(no transcript)"
        }`
    )
    .join("\n");

  return `
## What the screenshot must show

${ctx.alt}

## What Matt was saying across these frames

${transcript}

${
  ctx.surroundingText
    ? `## The article prose around this screenshot\n\n${ctx.surroundingText}`
    : ""
}
`.trim();
}

/** Coarse pass: localise the right second within the search window. */
export const COARSE_PASS_INSTRUCTIONS = `
The frames below are sampled roughly one second apart across the search window.
Pick the ONE frame closest to the ideal screenshot. You are localising the right
moment, not making the final choice — a later pass will refine within a fraction
of a second of whatever you pick, so favour the right *moment* over small
imperfections in timing.

Frames from the clip the writer named are marked. When two frames are genuinely
equally good, prefer the one from the named clip.

If no frame in the window shows what the alt text describes, return null for
frameNumber and explain what you saw instead. Do not settle for a frame that
does not show the described content — a confidently wrong screenshot is worse
than none, because it will not get checked.
`.trim();

/** Fine pass: pick the exact frame from a fifth-of-a-second spread. */
export const FINE_PASS_INSTRUCTIONS = `
These frames are a fifth of a second apart, around the moment picked by the
previous pass. They will look very similar. Pick the single best one, judging
on the details that separate near-identical frames: output fully arrived rather
than still landing, nothing mid-animation, no popup, text selection clearly
visible, and Matt not caught mid-blink.

Return the frame number of your choice, and a one-sentence reason written for
Matt — say what is on screen and why this frame, not the mechanics of your
decision.
`.trim();
