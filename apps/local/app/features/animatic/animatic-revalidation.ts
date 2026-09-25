import { useRef } from "react";
import type { AnimaticClipMockup } from "./animatic-timeline";

/**
 * How the Animatic picks up an edit made behind its back — without restarting.
 *
 * The author watches an Animatic while an agent is still writing it: a line is
 * rewritten, a frame is redrawn, a Clip Mockup is added. So the page polls its
 * own loader (`useFocusRevalidate`) instead of waiting for a reload.
 *
 * THE POLL MUST BE INVISIBLE. A revalidation hands back a brand new array of
 * rows every two seconds, and every one of them is a new object even when not
 * one byte changed. Feed those straight to `<Player>` and its `inputProps`
 * change identity on every poll, which remounts the composition — the picture
 * jumps back to the first frame and the speech starts again. The author loses
 * his place every two seconds.
 *
 * `useStableMockups` is the guard: it compares the rows BY VALUE and keeps
 * handing back the array it already returned while nothing has changed. The
 * timeline, the `inputProps` and the Player's own props then stay identical
 * across a poll, and a poll that found no change costs nothing at all.
 */

/**
 * Every field of a Clip Mockup that the Animatic renders or times, as one
 * string. Nothing else is on the row, so this is a full comparison rather than
 * a cheap approximation — a change the Animatic can show is a change here.
 */
export function animaticMockupsSignature(
  mockups: readonly AnimaticClipMockup[]
): string {
  return JSON.stringify(
    mockups.map((mockup) => [
      mockup.id,
      mockup.position,
      mockup.line,
      mockup.durationSeconds,
      mockup.imageUrl,
      mockup.audioUrl,
      mockup.imageMissing,
      mockup.audioMissing,
    ])
  );
}

/**
 * The same rows, but the SAME ARRAY for as long as the rows say the same thing.
 */
export function useStableMockups(
  mockups: readonly AnimaticClipMockup[]
): readonly AnimaticClipMockup[] {
  const signature = animaticMockupsSignature(mockups);
  const held = useRef({ signature, mockups });

  if (held.current.signature !== signature) {
    held.current = { signature, mockups };
  }

  return held.current.mockups;
}
