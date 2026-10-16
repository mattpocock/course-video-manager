/**
 * The one definition of silence (ADR 0034 §5), read by every silence detector:
 * ffmpeg's silencedetect on old OBS files and in the CVM recorder's camera+mic
 * process. Change a value here and all of them move together.
 */

/**
 * The fixed noise level, in dBFS, as silencedetect's `n`: a sample is silent
 * when its absolute amplitude is below it. A sample peak, not an RMS level.
 *
 * Only for work that is not recording: chunking or re-cutting old Footage. A Recording Session cuts with the
 * threshold of the AV Calibration it started under, read once when it
 * starts (`SilenceThreshold`).
 */
export const DEFAULT_SILENCE_THRESHOLD_DB = -38;

/**
 * The threshold a Recording Session cuts with, and the AV Calibration that
 * set it: the latest passed one when recording started, or null (and
 * `DEFAULT_SILENCE_THRESHOLD_DB`) when none has passed yet.
 */
export type SilenceThreshold = {
  readonly thresholdDb: number;
  readonly avCalibrationId: string | null;
};

/** No AV Calibration has passed: the fixed default. */
export const UNCALIBRATED_SILENCE_THRESHOLD: SilenceThreshold = {
  thresholdDb: DEFAULT_SILENCE_THRESHOLD_DB,
  avCalibrationId: null,
};

/** Minimum clip length (in seconds) — clips shorter than this are discarded */
export const MINIMUM_CLIP_LENGTH_SECONDS = 1;

/**
 * Slack for floating point only: a speech cut to exactly the minimum, then
 * moved by a mic offset, can come out a hair under it.
 */
const CLIP_LENGTH_TOLERANCE_SECONDS = 1e-6;

/**
 * THE rule for whether speech from `startTime` to `endTime` (seconds, one
 * clock) is long enough to be a Clip. `speechToClipBounds` cuts with it, and
 * the CVM recorder's speech detector starts a Take with it
 * (`takeStartsAt`), so the two can never disagree about a speech.
 */
export const isLongEnoughForClip = (
  startTime: number,
  endTime: number
): boolean =>
  endTime - startTime >=
  MINIMUM_CLIP_LENGTH_SECONDS - CLIP_LENGTH_TOLERANCE_SECONDS;

/**
 * The file time from which speech that started at `speechStart` and has not
 * been reported silent is provably long enough to be a Clip
 * (`isLongEnoughForClip`): silencedetect reports a silence only once it has
 * lasted `minSilenceSeconds`, so any silence that started before
 * `speechStart + MINIMUM_CLIP_LENGTH_SECONDS` would have been reported by
 * now. The CVM recorder's Take starts here, a Silence Length after the
 * minimum Clip length.
 */
export const takeStartsAt = (
  speechStart: number,
  minSilenceSeconds: number
): number => speechStart + MINIMUM_CLIP_LENGTH_SECONDS + minSilenceSeconds;

/**
 * Seconds of room left at the end of an auto-edited Clip, so a cut does not
 * land on the last syllable.
 *
 * Here rather than in `silence-detection.ts`, its original home, because it has
 * a SECOND consumer that must not drift from it: the gap an Animatic holds
 * between Clip Mockups (`CLIP_MOCKUP_GAP_SECONDS`), so a mock paces like the
 * filmed Lesson will. That consumer is client code and this module — unlike
 * `silence-detection.ts` — pulls in no ffmpeg.
 */
export const AUTO_EDITED_END_PADDING_SECONDS = 0.08;

/**
 * Per-Recording-Session "Silence Length" mode (see GLOSSARY.md).
 * Controls how long a silence must last before it ends a clip.
 * Applied symmetrically to the frontend speech detector and the backend
 * FFmpeg silence detection.
 */
export type SilenceLength = "short" | "long";

export const SILENCE_LENGTH_SHORT_SECONDS = 0.8;
export const SILENCE_LENGTH_LONG_SECONDS = 2.0;

export const DEFAULT_SILENCE_LENGTH: SilenceLength = "short";

export const silenceLengthToSeconds = (silenceLength: SilenceLength): number =>
  silenceLength === "short"
    ? SILENCE_LENGTH_SHORT_SECONDS
    : SILENCE_LENGTH_LONG_SECONDS;

/**
 * What counts as silence for one Recording Session: every channel's samples
 * below its threshold for at least the Silence Length.
 */
export type SilenceRule = {
  readonly thresholdDb: number;
  readonly minSilenceSeconds: number;
};

export const silenceRule = (
  silenceLength: SilenceLength,
  thresholdDb: number
): SilenceRule => ({
  thresholdDb,
  minSilenceSeconds: silenceLengthToSeconds(silenceLength),
});

/** The rule as ffmpeg's filter (mono=0: every channel must be silent). */
export const silencedetectFilter = (rule: SilenceRule): string =>
  `silencedetect=n=${rule.thresholdDb}dB:d=${rule.minSilenceSeconds}`;

/** The noise level as a linear amplitude, the value silencedetect compares samples with. */
export const silenceThresholdAmplitude = (rule: SilenceRule): number =>
  10 ** (rule.thresholdDb / 20);
