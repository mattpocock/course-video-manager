/**
 * The view model behind the section page's **Scripts** tab: the whole section's
 * teleprompter scripts flattened into one ordered document — lesson by lesson,
 * video by video. See {@link SectionScriptsView} for the surface that renders it.
 *
 * Kept as a pure function so it can be unit-tested in isolation (mirrors
 * section-grid-utils / section-transcript): lesson/video order is preserved as
 * given, lessons with no videos are dropped (nothing to write), and every
 * video's `script` is normalised to a plain string ("" when absent) so each
 * field seeds from the loader without null-checking downstream.
 */

/** The loosest shape the builder needs — accepts loader and optimistic sections. */
export type SectionForScripts = {
  lessons: Array<{
    id: string;
    title: string | null;
    path: string;
    videos: Array<{ id: string; title: string; script?: string | null }>;
  }>;
};

export type SectionScriptVideo = {
  videoId: string;
  title: string;
  script: string;
};

export type SectionScriptLesson = {
  lessonId: string;
  /** Rendered heading — the lesson title, falling back to its derived path. */
  heading: string;
  videos: SectionScriptVideo[];
};

export function buildSectionScripts(
  section: SectionForScripts
): SectionScriptLesson[] {
  return section.lessons
    .map((lesson) => ({
      lessonId: lesson.id,
      heading: lesson.title || lesson.path,
      videos: lesson.videos.map((video) => ({
        videoId: video.id,
        title: video.title,
        script: video.script ?? "",
      })),
    }))
    .filter((lesson) => lesson.videos.length > 0);
}
