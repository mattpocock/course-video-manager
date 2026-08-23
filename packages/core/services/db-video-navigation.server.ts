import { Effect } from "effect";

/**
 * "Where does the author go next?" — the Video-to-Video and Video-to-empty-
 * Lesson walks behind the editor's next/previous buttons.
 *
 * They ask no questions of the database: everything they need is already in
 * the Course's navigation tree, so they take that reader as their one
 * dependency and live apart from the Video table's own operations.
 */
export type VideoNavigationDeps = {
  getCourseNavigationData: (id: string) => Effect.Effect<any, any>;
};

export const createVideoNavigationOps = (deps: VideoNavigationDeps) => {
  const { getCourseNavigationData } = deps;

  const getNextVideoId = Effect.fn("getNextVideoId")(function* (currentVideo: {
    id: string;
    lesson: {
      id: string;
      videos: Array<{ id: string; title: string }>;
      section: { repoVersion: { repo: { id: string } } };
    } | null;
  }) {
    const currentLesson = currentVideo.lesson;
    if (!currentLesson) return null; // Standalone videos have no next/prev
    const repo = currentLesson.section.repoVersion.repo;

    const videosInLesson = [...currentLesson.videos].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
    const currentVideoIndex = videosInLesson.findIndex(
      (v) => v.id === currentVideo.id
    );

    if (currentVideoIndex < videosInLesson.length - 1) {
      return videosInLesson[currentVideoIndex + 1]?.id ?? null;
    }

    const courseNav = yield* getCourseNavigationData(repo.id);
    const latestVersionSections = courseNav.versions[0]?.sections ?? [];

    const allRealLessons = latestVersionSections.flatMap(
      (s: (typeof latestVersionSections)[number]) => s.lessons
    );

    const currentIndex = allRealLessons.findIndex(
      (l: (typeof allRealLessons)[number]) => l.id === currentLesson.id
    );

    for (let i = currentIndex + 1; i < allRealLessons.length; i++) {
      const nextLesson = allRealLessons[i]!;
      const firstVideo = nextLesson.videos.sort(
        (a: { title: string }, b: { title: string }) =>
          a.title.localeCompare(b.title)
      )[0];
      if (firstVideo) return firstVideo.id;
    }

    return null;
  });

  const getPreviousVideoId = Effect.fn("getPreviousVideoId")(
    function* (currentVideo: {
      id: string;
      lesson: {
        id: string;
        videos: Array<{ id: string; title: string }>;
        section: { repoVersion: { repo: { id: string } } };
      } | null;
    }) {
      const currentLesson = currentVideo.lesson;
      if (!currentLesson) return null; // Standalone videos have no next/prev
      const repo = currentLesson.section.repoVersion.repo;

      const videosInLesson = [...currentLesson.videos].sort((a, b) =>
        a.title.localeCompare(b.title)
      );
      const currentVideoIndex = videosInLesson.findIndex(
        (v) => v.id === currentVideo.id
      );

      if (currentVideoIndex > 0) {
        return videosInLesson[currentVideoIndex - 1]?.id ?? null;
      }

      const courseNav = yield* getCourseNavigationData(repo.id);
      const latestVersionSections = courseNav.versions[0]?.sections ?? [];

      const allRealLessons = latestVersionSections.flatMap(
        (s: (typeof latestVersionSections)[number]) => s.lessons
      );

      const currentIndex = allRealLessons.findIndex(
        (l: (typeof allRealLessons)[number]) => l.id === currentLesson.id
      );

      for (let i = currentIndex - 1; i >= 0; i--) {
        const prevLesson = allRealLessons[i]!;
        const videos = prevLesson.videos.sort(
          (a: { title: string }, b: { title: string }) =>
            a.title.localeCompare(b.title)
        );
        const lastVideo = videos[videos.length - 1];
        if (lastVideo) return lastVideo.id;
      }

      return null;
    }
  );

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
