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

import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import {
  clipComposite,
  clipLayers,
  clipSource,
  isUntouched,
  type ClipComposite,
  type ClipSourceRow,
  type Layer,
  wholeExportFrameSeconds,
} from "@/packages/clip-source";
import type { PauseType } from "./video-processing-service";

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

/**
 * A Clip as the database holds it, before any padding is applied: its span,
 * and the columns that say how the export draws it (`clipSource`), which
 * decide whether its Video is rendered Clip by Clip. They are required, so a
 * query that does not load the Recording Session and Layers cannot be timed.
 *
 * `pauseType` is the raw column: a `varchar` that predates the enum and can
 * hold anything. It is narrowed to a **Pause Type** exactly once, on the way
 * into the export, by {@link paddedClipDurationsInSeconds}.
 */
export type SourceClipDuration = Pick<
  ClipSourceRow,
  "videoFilename" | "sourceStartTime" | "sourceEndTime"
> &
  Required<
    Pick<ClipSourceRow, "recordingSessionId" | "recordingSession" | "layers">
  > & {
    pauseType: string | null;
  };

export const needsClipSegments = (
  clips: readonly {
    readonly composite: ClipComposite | null;
    readonly layers: readonly Layer[];
  }[]
): boolean =>
  clips.some((clip) => clip.composite !== null || !isUntouched(clip.layers));

const rowsRenderClipByClip = (clips: readonly SourceClipDuration[]): boolean =>
  needsClipSegments(
    clips.map((clip) => {
      const source = clipSource(clip);
      return { composite: clipComposite(source), layers: clipLayers(source) };
    })
  );

/** The one value the renderer acts on; everything else renders as "none". */
const toPauseType = (rawPauseType: string | null): PauseType =>
  rawPauseType === "long" ? "long" : "none";

/**
 * What each Clip asks the renderer for, in the order the renderer gets them:
 * its span of source, plus the padding the final Clip carries.
 *
 * On a Video rendered Clip by Clip ({@link needsClipSegments}) every
 * segment is a whole number of 60 fps frames (`wholeExportFrameSeconds`), so
 * each Clip here is rounded up to whole frames, long Pause included, and the
 * exported file is the sum of those. A Video rendered in one pass is cut at
 * the exact spans. {@link exportedClipSecondsIn} gives the same seconds per
 * Clip with no final padding (it trails the last Clip, so it moves nothing):
 * where whatever follows a Clip starts, such as a Chapter.
 *
 * The export step feeds these to the renderer AND to the prediction below,
 * and the Chapters and Overlays are timed from them, so the file that is
 * asked for, the file that is checked for and the times on it cannot differ.
 */
export const paddedClipDurationsInSeconds = (
  clips: readonly SourceClipDuration[]
): ExportClipDuration[] => {
  const wholeFrames = rowsRenderClipByClip(clips);
  return clips.map((clip, index, array) =>
    askedDuration(
      clip,
      index === array.length - 1 ? FINAL_VIDEO_PADDING : 0,
      wholeFrames
    )
  );
};

export const exportedClipSecondsIn = (
  clips: readonly SourceClipDuration[]
): ((clip: SourceClipDuration) => number) => {
  const wholeFrames = rowsRenderClipByClip(clips);
  return (clip) =>
    clipExportDurationInSeconds(askedDuration(clip, 0, wholeFrames));
};

const askedDuration = (
  clip: SourceClipDuration,
  padding: number,
  wholeFrames: boolean
): ExportClipDuration => {
  const pauseType = toPauseType(clip.pauseType);
  const span = clip.sourceEndTime - clip.sourceStartTime + padding;
  if (!wholeFrames) return { duration: span, pauseType };
  const pause = pauseSeconds(pauseType);
  return {
    duration: wholeExportFrameSeconds(span + pause) - pause,
    pauseType,
  };
};

/** A Clip as the export step describes it to the renderer. */
export type ExportClipDuration = {
  /**
   * Seconds of source, including the final-clip padding where it applies,
   * rounded up to whole frames on a Video rendered Clip by Clip.
   */
  duration: number;
  pauseType: PauseType;
};

/** The seconds one Clip contributes to the output, long Pause included. */
export const clipExportDurationInSeconds = (clip: ExportClipDuration): number =>
  clip.duration + pauseSeconds(clip.pauseType);

const pauseSeconds = (pauseType: PauseType): number =>
  pauseType === "long" ? LONG_PAUSE_DURATION_IN_SECONDS : 0;

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
