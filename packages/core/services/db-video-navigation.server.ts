import { Effect } from "effect";
import type { CourseNavigationData } from "./db-course-operations.server.js";

/**
 * "Where does the author go next?" — the Video-to-Video and Video-to-empty-
 * Lesson walks behind the editor's next/previous buttons.
 *
 * They ask no questions of the database: everything they need is already in
 * the Course's navigation tree, so they take that reader as their one
 * dependency and live apart from the Video table's own operations.
 */
export type VideoNavigationDeps = {
  getCourseNavigationData: (
    id: string
  ) => Effect.Effect<CourseNavigationData, unknown>;
};

/** The Video the walks start from, and the slice of it they read. */
type VideoWithLesson = {
  id: string;
  lesson: {
    id: string;
    videos: Array<{ id: string; title: string }>;
    section: { repoVersion: { repo: { id: string } } };
  } | null;
};

/**
 * Which way along the Course a walk travels.
 *
 * "next" and "previous" are the same walk read in opposite directions — step
 * one Video along inside the current Lesson, and when that runs out, step one
 * Lesson along and take the Video at the near end of it. The two directions
 * differ only in the sign of the step and which end of a Lesson's Videos is
 * "near", so they are that pair rather than two copies of the walk.
 */
const DIRECTIONS = {
  next: { step: 1, nearEnd: <T>(videos: T[]) => videos[0] },
  previous: {
    step: -1,
    nearEnd: <T>(videos: T[]) => videos[videos.length - 1],
  },
} as const;

/** Videos inside a Lesson are ordered by title, everywhere a walk looks. */
const byTitle = <T extends { title: string }>(videos: ReadonlyArray<T>): T[] =>
  [...videos].sort((a, b) => a.title.localeCompare(b.title));

export const createVideoNavigationOps = (deps: VideoNavigationDeps) => {
  const { getCourseNavigationData } = deps;

  const adjacentVideoId = (direction: keyof typeof DIRECTIONS) =>
    Effect.fn(`get${direction === "next" ? "Next" : "Previous"}VideoId`)(
      function* (currentVideo: VideoWithLesson) {
        const { step, nearEnd } = DIRECTIONS[direction];

        const currentLesson = currentVideo.lesson;
        if (!currentLesson) return null; // Standalone videos have no next/prev
        const repo = currentLesson.section.repoVersion.repo;

        // The obvious step first: the neighbouring Video in this same Lesson.
        const videosInLesson = byTitle(currentLesson.videos);
        const currentVideoIndex = videosInLesson.findIndex(
          (v) => v.id === currentVideo.id
        );
        const sibling = videosInLesson[currentVideoIndex + step];
        if (sibling) return sibling.id;

        // Off the end of this Lesson, so walk the Course's Lessons the same
        // way and take the first one that has a Video at all — an empty Lesson
        // in between is stepped over, not stopped at.
        const courseNav = yield* getCourseNavigationData(repo.id);
        const lessons = (courseNav.versions[0]?.sections ?? []).flatMap(
          (section) => section.lessons
        );
        const currentIndex = lessons.findIndex(
          (l) => l.id === currentLesson.id
        );

        for (
          let i = currentIndex + step;
          i >= 0 && i < lessons.length;
          i += step
        ) {
          const video = nearEnd(byTitle(lessons[i]!.videos));
          if (video) return video.id;
        }

        return null;
      }
    );

  const getNextVideoId = adjacentVideoId("next");
  const getPreviousVideoId = adjacentVideoId("previous");

  /**
   * Gets the next lesson that has no videos, starting from the current video's lesson.
   * Returns lesson info if found, null if no such lesson exists.
   */
  const getNextLessonWithoutVideo = Effect.fn("getNextLessonWithoutVideo")(
    function* (currentVideo: {
      lesson: {
        id: string;
        section: {
          repoVersion: {
            repo: { id: string };
          };
        };
      } | null;
    }) {
      const currentLesson = currentVideo.lesson;
      if (!currentLesson) return null; // Standalone videos have no next/prev

      const currentSection = currentLesson.section;
      const repo = currentSection.repoVersion.repo;

      // Need to get all sections and lessons to find next lesson without video.
      // Use the slim navigation query (no clips) — we only need video counts.
      const repoWithVersions = yield* getCourseNavigationData(repo.id);
      const latestVersionSections =
        repoWithVersions.versions[0]?.sections ?? [];

      // Find current lesson in the structure
      for (let sIdx = 0; sIdx < latestVersionSections.length; sIdx++) {
        const section = latestVersionSections[sIdx]!;
        for (let lIdx = 0; lIdx < section.lessons.length; lIdx++) {
          const lesson = section.lessons[lIdx]!;
          if (lesson.id === currentLesson.id) {
            // Search for next lesson with no videos, starting from next lesson
            // First check remaining lessons in current section
            for (
              let nextLIdx = lIdx + 1;
              nextLIdx < section.lessons.length;
              nextLIdx++
            ) {
              const nextLesson = section.lessons[nextLIdx]!;
              if (nextLesson.videos.length === 0) {
                return {
                  lessonId: nextLesson.id,
                  lessonTitle: nextLesson.title,
                  sectionPath: section.title,
                };
              }
            }

            // Then check lessons in subsequent sections
            for (
              let nextSIdx = sIdx + 1;
              nextSIdx < latestVersionSections.length;
              nextSIdx++
            ) {
              const nextSection = latestVersionSections[nextSIdx]!;
              for (const nextLesson of nextSection.lessons) {
                if (nextLesson.videos.length === 0) {
                  return {
                    lessonId: nextLesson.id,
                    lessonTitle: nextLesson.title,
                    sectionPath: nextSection.title,
                  };
                }
              }
            }

            // No lesson without video found
            return null;
          }
        }
      }

      return null;
    }
  );

  return {
    getNextVideoId,
    getPreviousVideoId,
    getNextLessonWithoutVideo,
  };
};
