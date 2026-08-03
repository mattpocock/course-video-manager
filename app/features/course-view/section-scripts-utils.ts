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

/** Longest collapsed preview we render before cutting to a word boundary. */
const PREVIEW_MAX_LENGTH = 100;

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

/**
 * Every video in the document, in reading order — the id list the Scripts tab's
 * collapse-all / expand-all control folds and unfolds in one go.
 */
export function scriptVideoIds(lessons: SectionScriptLesson[]): string[] {
  return lessons.flatMap((lesson) => lesson.videos.map((v) => v.videoId));
}

/**
 * The one-line stand-in shown in place of a folded script, so a collapsed
 * document still reads as an outline rather than a list of bare titles. `null`
 * when the script is blank — there is nothing to preview, and the field says so
 * with its own placeholder.
 */
export function scriptPreview(script: string): string | null {
  const line = script
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  if (line.length <= PREVIEW_MAX_LENGTH) return line;

  const cut = line.slice(0, PREVIEW_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
