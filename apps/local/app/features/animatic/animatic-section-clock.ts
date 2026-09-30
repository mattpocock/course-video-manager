import {
  ANIMATIC_FPS,
  formatRunTime,
  segmentFrames,
} from "./animatic-timeline";

/**
 * The Section clock: how far through the whole Section's Animatics the author
 * is, and how long is left — in the time THIS SITTING takes.
 *
 * THE AUTHOR REVIEWS A SECTION AT A TIME. He walks NEXT from Animatic to
 * Animatic across every Lesson of a Section in one sitting, so "clip 5 of 22"
 * in one Video tells him nothing about when he is done. This answers that: the
 * elapsed and the total run time of every Animatic in the Section, with the
 * playhead's place in it.
 *
 * DIVIDED BY THE PLAYBACK RATE, on purpose, and unlike the run-time pill in the
 * other corner. That pill is the length of the filmed Lesson, which is what the
 * author judges. This one is how long he still has to sit here, which at two
 * and a half times is two fifths of it.
 *
 * Arithmetic only — no React, no Remotion, no database. The loader hands the
 * Section's Videos in, and the player hands the frame and the rate in.
 */

/** One Video of the Section, with the speech durations of its Clip Mockups. */
export interface AnimaticSectionVideo {
  readonly id: string;
  readonly title: string;
  readonly durationsSeconds: readonly number[];
}

/** One Lesson of the Section, in Section order, with its Videos. */
export interface AnimaticSectionLesson {
  readonly videos: readonly AnimaticSectionVideo[];
}

/** Where the current Animatic sits inside its Section, in frames at 1x. */
export interface AnimaticSectionRunTime {
  /** Frames of every Animatic before this one in the Section. */
  readonly framesBefore: number;
  /** Frames of every Animatic in the Section, this one included. */
  readonly totalFrames: number;
}

/** The frames a Video's Animatic runs for. Zero for one with no Clip Mockups. */
function animaticFrames(durationsSeconds: readonly number[]): number {
  return durationsSeconds.reduce(
    (total, seconds) => total + segmentFrames(seconds).durationInFrames,
    0
  );
}

/**
 * Place the current Video in its Section.
 *
 * THE SAME ORDER AS PREVIOUS/NEXT: Lessons in Section order, and the Videos
 * inside a Lesson by title — so the clock counts down in the order the author
 * actually walks. A Video with no Clip Mockups adds nothing, and NEXT still
 * stops on it.
 *
 * A Video not found in the Section (a standalone Video has no Section) is a
 * Section of one.
 */
export function sectionRunTime(params: {
  readonly lessons: readonly AnimaticSectionLesson[];
  readonly currentVideoId: string;
  /** The current Video's own Clip Mockups, used when it is not in `lessons`. */
  readonly currentDurationsSeconds: readonly number[];
}): AnimaticSectionRunTime {
  const videos = params.lessons.flatMap((lesson) =>
    // `localeCompare`, exactly as `db-video-navigation.server.ts` sorts them.
    [...lesson.videos].sort((a, b) => a.title.localeCompare(b.title))
  );
  const currentIndex = videos.findIndex(
    (video) => video.id === params.currentVideoId
  );

  if (currentIndex === -1) {
    return {
      framesBefore: 0,
      totalFrames: animaticFrames(params.currentDurationsSeconds),
    };
  }

  let framesBefore = 0;
  let totalFrames = 0;
  for (const [index, video] of videos.entries()) {
    const frames = animaticFrames(video.durationsSeconds);
    if (index < currentIndex) framesBefore += frames;
    totalFrames += frames;
  }
  return { framesBefore, totalFrames };
}

/** The clock at one frame of the current Animatic, in seconds of this sitting. */
export interface AnimaticSectionClock {
  readonly elapsedSeconds: number;
  readonly totalSeconds: number;
  readonly remainingSeconds: number;
}

export function sectionClockAt(params: {
  readonly runTime: AnimaticSectionRunTime;
  /** The playhead's frame inside the current Animatic. */
  readonly frame: number;
  readonly playbackRate: number;
}): AnimaticSectionClock {
  const rate = params.playbackRate > 0 ? params.playbackRate : 1;
  const toSittingSeconds = (frames: number) => frames / ANIMATIC_FPS / rate;
  const elapsedFrames = Math.min(
    params.runTime.totalFrames,
    params.runTime.framesBefore + Math.max(0, params.frame)
  );
  const elapsedSeconds = toSittingSeconds(elapsedFrames);
  const totalSeconds = toSittingSeconds(params.runTime.totalFrames);
  return {
    elapsedSeconds,
    totalSeconds,
    remainingSeconds: Math.max(0, totalSeconds - elapsedSeconds),
  };
}

/** `3:12 / 8:40 · 5:28 left` — what the badge in the corner reads. */
export function formatSectionClock(clock: AnimaticSectionClock): string {
  return `${formatRunTime(clock.elapsedSeconds)} / ${formatRunTime(
    clock.totalSeconds
  )} · ${formatRunTime(clock.remainingSeconds)} left`;
}
