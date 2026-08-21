/**
 * The rule that decides whether an export is a truncation.
 *
 * An Exported Video used to be accepted purely because ffmpeg exited zero and
 * left a file behind. Nothing compared the file's real duration with the
 * duration its Clips ask for, so a truncated encode became shippable and could
 * reach the site. Three of one course's 93 exports were short — by 9.6s, 34.3s
 * and 71.3s — and one of them was live.
 *
 * Everything here is pure: durations in, a verdict out. The measuring and the
 * refusing live at the one decision point that owns the export.
 */

/**
 * A long Pause extends the Clip it belongs to by this much, added by the
 * concat pass rather than by the caller that supplies the Clip durations.
 *
 * It lives here, beside the rule that has to predict the output, so that the
 * expected duration and the duration ffmpeg is actually told to produce can
 * never drift apart.
 */
export const LONG_PAUSE_DURATION_IN_SECONDS = 0.18;

/**
 * How far short of its Clips an export may fall and still be accepted.
 *
 * One second, chosen from live data: 90 of the crash course's 93 exports fall
 * inside it, and all three outside it are genuinely truncated. It is a floor,
 * not a window — a file LONGER than expected is always accepted, because
 * container rounding must never fail a good release.
 */
export const EXPORT_DURATION_TOLERANCE_IN_SECONDS = 1;

/** A Clip as the export step describes it to the renderer. */
export type ExportClipDuration = {
  /** Seconds of source, including the final-clip padding where it applies. */
  duration: number;
  pauseType: string;
};

/** The seconds one Clip contributes to the output, long Pause included. */
export const clipExportDurationInSeconds = (
  clip: ExportClipDuration
): number =>
  clip.pauseType === "long"
    ? clip.duration + LONG_PAUSE_DURATION_IN_SECONDS
    : clip.duration;

/**
 * What an honest encode of these Clips produces: the concat filter's output is
 * exactly the Clips end to end, so the summed durations are the duration.
 */
export const expectedExportDurationInSeconds = (
  clips: readonly ExportClipDuration[]
): number =>
  clips.reduce((total, clip) => total + clipExportDurationInSeconds(clip), 0);

/**
 * Is this measured duration unacceptably short against what was asked for?
 *
 * A file with no playable duration at all is always refused, however little
 * was expected of it. Otherwise only a shortfall of MORE than the tolerance
 * fails: exactly at the tolerance passes, and any overrun passes.
 */
export const isExportUnacceptablyShort = (input: {
  expectedDurationInSeconds: number;
  actualDurationInSeconds: number;
}): boolean => {
  // Also catches a NaN from an ffprobe that could not read the file.
  if (!(input.actualDurationInSeconds > 0)) return true;
  return (
    input.actualDurationInSeconds <
    input.expectedDurationInSeconds - EXPORT_DURATION_TOLERANCE_IN_SECONDS
  );
};
