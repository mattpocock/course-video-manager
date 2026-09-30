import { describe, expect, it } from "vitest";
import {
  formatSectionClock,
  sectionClockAt,
  sectionRunTime,
} from "./animatic-section-clock";
import {
  ANIMATIC_FPS,
  buildAnimaticTimeline,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * The Section clock is how long the author still has to sit through a
 * Section's Animatics. It must count the same frames the player plays, walk
 * the Videos in the order NEXT walks them, and divide by the rate he watches
 * at.
 */

const video = (id: string, title: string, durationsSeconds: number[]) => ({
  id,
  title,
  durationsSeconds,
});

const framesOf = (durations: number[]) =>
  buildAnimaticTimeline(
    durations.map((durationSeconds, i): AnimaticClipMockup => ({
      id: `cm_${i}`,
      line: "",
      position: i + 1,
      order: `a${i}`,
      durationSeconds,
      imageUrl: "",
      audioUrl: null,
      imageMissing: false,
      audioMissing: false,
    }))
  ).durationInFrames;

describe("sectionRunTime", () => {
  it("counts the same frames the player plays for each Animatic", () => {
    const runTime = sectionRunTime({
      lessons: [{ videos: [video("v1", "a", [1.3, 2.71, 4])] }],
      currentVideoId: "v1",
      currentDurationsSeconds: [1.3, 2.71, 4],
    });
    expect(runTime).toEqual({
      framesBefore: 0,
      totalFrames: framesOf([1.3, 2.71, 4]),
    });
  });

  it("walks Lessons in order and a Lesson's Videos by title, as NEXT does", () => {
    const runTime = sectionRunTime({
      lessons: [
        {
          videos: [video("b", "02 second", [10]), video("a", "01 first", [5])],
        },
        { videos: [video("c", "01 third", [20])] },
      ],
      currentVideoId: "c",
      currentDurationsSeconds: [20],
    });
    expect(runTime.framesBefore).toBe(framesOf([5]) + framesOf([10]));
    expect(runTime.totalFrames).toBe(
      framesOf([5]) + framesOf([10]) + framesOf([20])
    );
  });

  it("adds nothing for a Video with no Clip Mockups", () => {
    const runTime = sectionRunTime({
      lessons: [{ videos: [video("a", "a", []), video("b", "b", [3])] }],
      currentVideoId: "b",
      currentDurationsSeconds: [3],
    });
    expect(runTime.framesBefore).toBe(0);
  });

  it("is a Section of one for a Video outside any Section", () => {
    const runTime = sectionRunTime({
      lessons: [],
      currentVideoId: "standalone",
      currentDurationsSeconds: [3, 4],
    });
    expect(runTime).toEqual({ framesBefore: 0, totalFrames: framesOf([3, 4]) });
  });
});

describe("sectionClockAt", () => {
  const tenMinutes = 10 * 60 * ANIMATIC_FPS;

  it("reads the Section at one times", () => {
    const clock = sectionClockAt({
      runTime: { framesBefore: 60 * ANIMATIC_FPS, totalFrames: tenMinutes },
      frame: 30 * ANIMATIC_FPS,
      playbackRate: 1,
    });
    expect(clock).toEqual({
      elapsedSeconds: 90,
      totalSeconds: 600,
      remainingSeconds: 510,
    });
  });

  it("divides by the rate: ten minutes at 2.5x is four", () => {
    const clock = sectionClockAt({
      runTime: { framesBefore: 0, totalFrames: tenMinutes },
      frame: 0,
      playbackRate: 2.5,
    });
    expect(clock.totalSeconds).toBe(240);
    expect(clock.remainingSeconds).toBe(240);
  });

  it("never runs past the end of the Section", () => {
    const clock = sectionClockAt({
      runTime: { framesBefore: 0, totalFrames: 100 },
      frame: 500,
      playbackRate: 1,
    });
    expect(clock.remainingSeconds).toBe(0);
  });
});

describe("formatSectionClock", () => {
  it("prints elapsed, total and what is left", () => {
    expect(
      formatSectionClock({
        elapsedSeconds: 192,
        totalSeconds: 520,
        remainingSeconds: 328,
      })
    ).toBe("3:12 / 8:40 · 5:28 left");
  });
});
