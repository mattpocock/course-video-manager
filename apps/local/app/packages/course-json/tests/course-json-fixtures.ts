/**
 * The builders every course.json test writes its world with.
 *
 * They live here because three test files now need them and the file-token
 * budget will not carry three copies. A package's own `tests/` fixtures are the
 * one thing a test may import besides an entry point (see
 * `.dependency-cruiser.cjs`), so this stays inside the seam.
 *
 * The defaults are deliberate: everything a builder makes is COMPLETE and
 * SHIPPABLE, so a test that exercises a gap states the gap and nothing else.
 */

import { Effect } from "effect";
import {
  ANNOUNCE_NOTHING,
  buildCourseJson,
  type BuildCourseJsonInput,
} from "../index";

type Section = BuildCourseJsonInput["sections"][0];
type Lesson = Section["lessons"][0];
type Video = Lesson["videos"][0];

/** Two clips, so a Video has an Export Hash and a non-zero timeline. */
export const CLIPS = [
  {
    videoFilename: "rec.mp4",
    sourceStartTime: 0,
    sourceEndTime: 10,
    pauseType: "none",
    zoomType: "none",
    order: "a0",
    overlays: [],
  },
  {
    videoFilename: "rec.mp4",
    sourceStartTime: 15,
    sourceEndTime: 25,
    pauseType: "none",
    zoomType: "none",
    order: "a1",
    overlays: [],
  },
];

// A complete, shippable Video by default: every field course.json requires is
// present (clips → hash + relativePath, a body, and a description). Tests that
// exercise incompleteness override these to null / [] explicitly.
export const makeVideo = (
  overrides: Partial<Video> & { title: string }
): Video => ({
  id: `video-${overrides.title}`,
  lineageId: `vid-lineage-${overrides.title}`,
  body: "Video body",
  description: "Video description",
  archived: false,
  format: "landscape",
  clips: CLIPS,
  chapters: [],
  ...overrides,
});

export const makeLesson = (
  overrides: Partial<Lesson> & { path: string; videos: Lesson["videos"] }
): Lesson => ({
  lineageId: `lesson-lineage-${overrides.path}`,
  title: overrides.path,
  description: "",
  authoringStatus: null as string | null,
  priority: 2,
  ...overrides,
});

export const makeSection = (
  overrides: Partial<Section> & { path: string; lessons: Section["lessons"] }
): Section => ({
  lineageId: `section-lineage-${overrides.path}`,
  title: overrides.title ?? overrides.path,
  description: "",
  ...overrides,
});

export const makeInput = (
  sections: BuildCourseJsonInput["sections"],
  includeTodoLessons = true,
  placeholderFloor: BuildCourseJsonInput["placeholderFloor"] = ANNOUNCE_NOTHING
): BuildCourseJsonInput => {
  const videoAssets = new Map<string, { sha256: string; bytes: number }>();
  for (const section of sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        videoAssets.set(video.id, { sha256: "a".repeat(64), bytes: 123 });
      }
    }
  }
  return {
    courseId: "course-1",
    courseVersionId: "course-version-1",
    courseName: "Test Course",
    assetBasePath: "versions/course-version-1-assets",
    sections,
    videoAssets,
    includeTodoLessons,
    placeholderFloor,
  };
};

export const run = (input: BuildCourseJsonInput) =>
  Effect.runPromise(buildCourseJson(input));

/** The failure, for the refusals. */
export const runFlip = (input: BuildCourseJsonInput) =>
  Effect.runPromise(buildCourseJson(input).pipe(Effect.flip));
