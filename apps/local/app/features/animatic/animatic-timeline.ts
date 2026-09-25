/**
 * The Animatic's clock.
 *
 * An Animatic is a Video's Clip Mockups played end to end: each frame held for
 * exactly as long as its line takes to say, then a short gap, then the next.
 * Everything here is arithmetic over the rows — no React, no Remotion — so the
 * run time the page prints, the frame the scrub bar lands on and the frame a
 * "jump to number 14" seeks to are all the same numbers.
 */

/**
 * The gap held after each Clip Mockup before the next one begins.
 *
 * THE ONE PLACE THIS NUMBER LIVES. It is the same 0.08 s the Clip cutter pads
 * the end of an auto-edited Clip with (`AUTO_EDITED_END_PADDING` in
 * `apps/local/app/services/silence-detection.ts`), so the Animatic's pacing
 * matches what the filmed Lesson will actually feel like rather than running
 * fractionally tighter than every real cut. Copied rather than imported: that
 * module is ffmpeg-bound and pulling it into the client bundle for one number
 * would drag the whole silence-detection graph with it.
 */
export const CLIP_MOCKUP_GAP_SECONDS = 0.08;

/**
 * The Animatic renders at 30fps. Every frame in it is a still, so the rate
 * only decides how finely the scrub bar can land — 30 is already finer than
 * the 0.08 s gap.
 */
export const ANIMATIC_FPS = 30;

/**
 * How long a Clip Mockup with no measured speech is held for. Rows written
 * before speech synthesis existed have a null `durationSeconds`; they are
 * reported as broken on the page, and this stops them flashing past at one
 * frame while the author reads the report.
 */
export const UNVOICED_HOLD_SECONDS = 2;

/** One Clip Mockup as the Animatic page needs it. */
export interface AnimaticClipMockup {
  readonly id: string;
  readonly line: string;
  /** 1-based position in the Animatic — the number the author says out loud. */
  readonly position: number;
  /** Measured seconds of speech, or `null` for an unvoiced row. */
  readonly durationSeconds: number | null;
  readonly imageUrl: string;
  readonly audioUrl: string | null;
  /** The frame named by the row is not on disk. */
  readonly imageMissing: boolean;
  /** The speech named by the row is not on disk, or the row names none. */
  readonly audioMissing: boolean;
}

/** One Clip Mockup placed on the Animatic's timeline. */
export interface AnimaticSegment {
  readonly mockup: AnimaticClipMockup;
  /** Where this Clip Mockup starts — the frame "jump to number N" seeks to. */
  readonly startFrame: number;
  /** Frames the speech runs for, before the gap. */
  readonly speechInFrames: number;
  /** Frames the whole segment occupies, speech plus the gap. */
  readonly durationInFrames: number;
}

export interface AnimaticTimeline {
  readonly segments: readonly AnimaticSegment[];
  /** The whole Animatic, in frames. Never zero — Remotion refuses that. */
  readonly durationInFrames: number;
  /** The whole Animatic in seconds, summed off the floats, never rounded. */
  readonly totalSeconds: number;
}

/**
 * Lay the Clip Mockups out end to end. Frame counts are rounded per segment
 * and then accumulated, so a segment's start is always the exact sum of the
 * segments before it and the seek target can never drift off the boundary.
 */
export function buildAnimaticTimeline(
  mockups: readonly AnimaticClipMockup[]
): AnimaticTimeline {
  const segments: AnimaticSegment[] = [];
  let startFrame = 0;
  let totalSeconds = 0;

  for (const mockup of mockups) {
    const speechSeconds = mockup.durationSeconds ?? UNVOICED_HOLD_SECONDS;
    const speechInFrames = Math.max(
      1,
      Math.round(speechSeconds * ANIMATIC_FPS)
    );
    const durationInFrames =
      speechInFrames + Math.round(CLIP_MOCKUP_GAP_SECONDS * ANIMATIC_FPS);

    segments.push({ mockup, startFrame, speechInFrames, durationInFrames });
    startFrame += durationInFrames;
    totalSeconds += speechSeconds + CLIP_MOCKUP_GAP_SECONDS;
  }

  return {
    segments,
    durationInFrames: Math.max(1, startFrame),
    totalSeconds,
  };
}

/** The index of the segment the playhead sits in, or `-1` for an empty timeline. */
export function segmentIndexAtFrame(
  segments: readonly AnimaticSegment[],
  frame: number
): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (frame >= segments[i]!.startFrame) return i;
  }
  return segments.length > 0 ? 0 : -1;
}

/** `4:07`, or `1:04:07` once an Animatic passes the hour. */
export function formatRunTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}
