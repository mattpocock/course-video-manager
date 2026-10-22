import type { ClipMockupVoiceStatus } from "@cvm/core/features/clip-mockups/voice-status";

/**
 * Whether a Video's Animatic can be exported to a finished file, and if not,
 * why — one answer for the Animatic page's Export button (disabled, with this
 * as its reason) and for the `export-animatic` Job (which refuses with it).
 *
 * An Animatic export is the Animatic AS IT WILL PLAY ONCE IT IS DONE: every
 * frame on disk and every line voiced. A Clip Mockup still timed by its word
 * count, or drawn as a "frame missing" card, would bake a guess into a file
 * that is then kept as if it were the real thing, so the export waits for
 * them instead.
 */
export interface AnimaticExportCandidate {
  readonly voiceStatus: ClipMockupVoiceStatus;
  /** The frame named by the row is not on disk. */
  readonly imageMissing: boolean;
  /** The speech named by the row is not on disk, or the row names none. */
  readonly audioMissing: boolean;
}

/** `3, 7 and 12`, or `3, 7, 12, 15, 20 and 4 more` past five. */
const positionsList = (positions: readonly number[]): string => {
  const shown = positions.slice(0, 5).map(String);
  const rest = positions.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
};

const clipMockupsNamed = (positions: readonly number[]) =>
  `Clip Mockup${positions.length === 1 ? "" : "s"} ${positionsList(positions)}`;

/**
 * `null` when the Animatic can be exported; otherwise what stands in the way,
 * naming the Clip Mockups by their 1-based position — the number the author
 * says out loud.
 */
export const animaticExportBlocker = (
  mockups: readonly AnimaticExportCandidate[]
): string | null => {
  if (mockups.length === 0) return "This Animatic has no Clip Mockups";

  const unvoiced: number[] = [];
  const failed: number[] = [];
  const frameless: number[] = [];
  mockups.forEach((mockup, index) => {
    const position = index + 1;
    if (mockup.voiceStatus === "failed") failed.push(position);
    else if (mockup.voiceStatus !== "ready" || mockup.audioMissing)
      unvoiced.push(position);
    if (mockup.imageMissing) frameless.push(position);
  });

  const problems = [
    unvoiced.length > 0 && `${clipMockupsNamed(unvoiced)}: no voice yet`,
    failed.length > 0 && `${clipMockupsNamed(failed)}: voice failed`,
    frameless.length > 0 && `${clipMockupsNamed(frameless)}: frame missing`,
  ].filter((problem): problem is string => problem !== false);

  return problems.length === 0 ? null : problems.join("; ");
};
