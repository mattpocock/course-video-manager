import { AUTO_EDITED_END_PADDING_SECONDS } from "@/silence-detection-constants";
import { estimateSpokenSeconds } from "@cvm/core/features/clip-mockups/estimate-spoken-seconds";
import type { ClipMockupVoiceStatus } from "@cvm/core/features/clip-mockups/voice-status";
import { formatDuration } from "@/lib/format-duration";

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
 * IMPORTED, NOT COPIED. It is the same padding the Clip cutter leaves at the
 * end of an auto-edited Clip, so the Animatic's pacing matches what the filmed
 * Lesson will actually feel like rather than running fractionally tighter than
 * every real cut — and two hand-written 0.08s could drift apart without
 * anything noticing. It is read from `silence-detection-constants`, which is
 * shared client/server and pulls in no ffmpeg, rather than from
 * `silence-detection.ts` itself.
 */
export const CLIP_MOCKUP_GAP_SECONDS = AUTO_EDITED_END_PADDING_SECONDS;

/**
 * The Animatic renders at 30fps. Every frame in it is a still, so the rate
 * only decides how finely the scrub bar can land — 30 is already finer than
 * the 0.08 s gap.
 */
export const ANIMATIC_FPS = 30;

/**
 * How far ahead of its own first frame a Clip Mockup is mounted.
 *
 * Every frame is fetched over HTTP from `clipMockupFrameUrl`, and a
 * `Series.Sequence` only mounts its children once the playhead is inside it —
 * so without this the `<img>` for Clip Mockup N+1 is created at the exact
 * frame it must already be painted on, and the browser shows the black
 * behind it while it fetches and decodes. That black reads as the 0.08 s gap
 * leaking into the picture, which it is not: the gap is audio-only, and the
 * frame is held right through it.
 *
 * Remotion's `premountFor` mounts the sequence early at `opacity: 0`, frozen
 * on its first frame, and pauses premounted `<Audio>` — so the speech does
 * not start early and the gap keeps meaning what it means. Half a second is
 * far more than a local fetch and decode needs, and only ever one extra Clip
 * Mockup is mounted at a time, so a long Animatic does not grow with it.
 */
export const CLIP_MOCKUP_PREMOUNT_IN_FRAMES = ANIMATIC_FPS / 2;

/**
 * How long a Clip Mockup with no measured speech AND no words to guess from is
 * held for — so it does not flash past at one frame.
 */
export const UNVOICED_HOLD_SECONDS = 2;

/**
 * The seconds a Clip Mockup's speech runs for on the timeline.
 *
 * `durationSeconds` is NULL on a Clip Mockup whose voice is not `ready`
 * (migration 0030): the Sidecar's `clip-mockup-voice` Job has not made it yet,
 * or gave up. Such a row is held for the word-count guess — the SAME guess
 * `cvm clip-mockup` prints — so the Animatic's run time agrees with the one
 * the agent reported, and moves to the measured length once the voice lands.
 */
export function clipMockupSpeechSeconds(mockup: {
  readonly durationSeconds: number | null;
  readonly line: string;
}): number {
  if (mockup.durationSeconds !== null) return mockup.durationSeconds;
  const estimate = estimateSpokenSeconds(mockup.line);
  return estimate > 0 ? estimate : UNVOICED_HOLD_SECONDS;
}

/** One Clip Mockup as the Animatic page needs it. */
export interface AnimaticClipMockup {
  readonly id: string;
  readonly line: string;
  /** 1-based position in the Animatic — the number the author says out loud. */
  readonly position: number;
  /**
   * Its key in the order space it shares with the Clip Mockup Chapters. The
   * clock ignores it; the sidebar reads it to tell which divider a row sits
   * under, because that membership is implicit in this one key and nowhere
   * else (see `animatic-chapters.ts`).
   */
  readonly order: string;
  /** Measured seconds of speech, or `null` while the voice is not `ready`. */
  readonly durationSeconds: number | null;
  /** Where its voice stands. Not `ready` means the timeline holds a guess. */
  readonly voiceStatus: ClipMockupVoiceStatus;
  /** Why the voice failed, when `voiceStatus` is `failed`. */
  readonly voiceError: string | null;
  readonly imageUrl: string;
  readonly audioUrl: string | null;
  /** The frame named by the row is not on disk. */
  readonly imageMissing: boolean;
  /** The speech named by the row is not on disk, or the row names none. */
  readonly audioMissing: boolean;
  /**
   * Where the voice begins inside its WAV, in seconds. Kokoro pads every line
   * with about a third of a second of silence, and the player starts the
   * audio here so the voice lands with its frame (#2265). The clock does not
   * read it: the segment still runs the whole WAV's length.
   */
  readonly speechStartSeconds: number;
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
  /** Clip Mockups timed by the word-count guess: voice not made yet. */
  readonly voicesPending: number;
  /** Clip Mockups timed by the word-count guess: voice gave up. */
  readonly voicesFailed: number;
}

/**
 * The frames one Clip Mockup occupies: its speech, rounded, and then the gap.
 * The ONE place this rounding happens, so the Animatic's own clock and the
 * Section clock that sums other Videos' Animatics count the same frames.
 */
export function segmentFrames(speechSeconds: number): {
  readonly speechInFrames: number;
  readonly durationInFrames: number;
} {
  const speechInFrames = Math.max(1, Math.round(speechSeconds * ANIMATIC_FPS));
  return {
    speechInFrames,
    durationInFrames:
      speechInFrames + Math.round(CLIP_MOCKUP_GAP_SECONDS * ANIMATIC_FPS),
  };
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
  let voicesPending = 0;
  let voicesFailed = 0;

  for (const mockup of mockups) {
    const speechSeconds = clipMockupSpeechSeconds(mockup);
    const { speechInFrames, durationInFrames } = segmentFrames(speechSeconds);
    if (mockup.voiceStatus === "pending") voicesPending++;
    if (mockup.voiceStatus === "failed") voicesFailed++;

    segments.push({ mockup, startFrame, speechInFrames, durationInFrames });
    startFrame += durationInFrames;
    totalSeconds += speechSeconds + CLIP_MOCKUP_GAP_SECONDS;
  }

  return {
    segments,
    durationInFrames: Math.max(1, startFrame),
    totalSeconds,
    voicesPending,
    voicesFailed,
  };
}

/**
 * The run time as the page prints it: `2:10` once every voice is measured,
 * `~2:10 (3 voices pending)` while any line is still timed by its words.
 */
export function formatAnimaticRunTime(timeline: AnimaticTimeline): string {
  const notes = [
    timeline.voicesPending > 0 &&
      `${timeline.voicesPending} voice${timeline.voicesPending === 1 ? "" : "s"} pending`,
    timeline.voicesFailed > 0 && `${timeline.voicesFailed} failed`,
  ].filter((note): note is string => note !== false);
  const runTime = formatDuration(timeline.totalSeconds);
  return notes.length === 0 ? runTime : `~${runTime} (${notes.join(", ")})`;
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

/**
 * The first frame of the Clip Mockup `delta` places from the one under the
 * playhead — what LEFT and RIGHT jump to. `null` past either end, so the step
 * holds rather than wrapping round.
 *
 * It walks EVERY segment, folded or not. A fold hides rows in the list; it
 * never skips frames, so a step through the picture does not skip them either.
 */
export function adjacentSegmentStartFrame(
  segments: readonly AnimaticSegment[],
  frame: number,
  delta: number
): number | null {
  const index = segmentIndexAtFrame(segments, frame);
  if (index < 0) return null;
  return segments[index + delta]?.startFrame ?? null;
}
