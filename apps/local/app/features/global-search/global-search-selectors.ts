import type { EntityRef } from "@/features/entity-links/entity-deep-link";
import type { globalSearchReducer } from "./global-search-reducer";

type Hit = globalSearchReducer.Hit;

/** A Global Search result group. A Short is a Video Format, not a kind. */
export type GlobalSearchGroup =
  "pitches" | "videos" | "shorts" | "courses" | "sections" | "lessons";

/** The order the groups are shown in, top to bottom. */
const GROUP_ORDER: ReadonlyArray<GlobalSearchGroup> = [
  "pitches",
  "videos",
  "shorts",
  "courses",
  "sections",
  "lessons",
];

export const GROUP_HEADINGS: Record<GlobalSearchGroup, string> = {
  pitches: "Pitches",
  videos: "Videos",
  shorts: "Shorts",
  courses: "Courses",
  sections: "Sections",
  lessons: "Lessons",
};

/** The most hits one group shows; narrow the query for the rest. */
export const GROUP_CAP = 5;

/** One result row: the hit, and what the dialog shows for it. */
export type GlobalSearchRow = {
  hit: Hit;
  group: GlobalSearchGroup;
  title: string;
  /** Where it sits, e.g. a Video's Course and Lesson. Null when nowhere. */
  context: string | null;
  /** The text around the match, when the match was not in the title. */
  snippet: string | null;
};

const groupOf = (hit: Hit): GlobalSearchGroup => {
  switch (hit.kind) {
    case "pitch":
      return "pitches";
    case "video":
      return hit.format === "short" ? "shorts" : "videos";
    case "course":
      return "courses";
    case "section":
      return "sections";
    case "lesson":
      return "lessons";
  }
};

const titleOf = (hit: Hit): string => {
  switch (hit.kind) {
    case "course":
      return hit.name;
    case "section":
    case "lesson":
      return hit.path;
    case "video":
    case "pitch":
      return hit.title;
  }
};

/** The fields that ARE a hit's title: a match there needs no snippet. */
const TITLE_FIELDS = new Set(["title", "name", "path"]);

const toRow = (hit: Hit): GlobalSearchRow => ({
  hit,
  group: groupOf(hit),
  title: titleOf(hit),
  context:
    hit.kind === "video" && hit.lessonId !== undefined
      ? `${hit.courseName} › ${hit.lessonTitle}`
      : null,
  snippet: TITLE_FIELDS.has(hit.field) ? null : hit.snippet,
});

/**
 * Every row the dialog shows, in display order: grouped by kind in
 * GROUP_ORDER, each group in the search's own order and capped at GROUP_CAP.
 * `highlighted` and `result-picked` index into this list.
 */
export const globalSearchRows = (
  state: globalSearchReducer.State
): GlobalSearchRow[] => {
  const rows = state.hits.map(toRow);
  return GROUP_ORDER.flatMap((group) =>
    rows.filter((row) => row.group === group).slice(0, GROUP_CAP)
  );
};

/** The rows split into their groups, for rendering one heading per group. */
export const globalSearchGroups = (
  state: globalSearchReducer.State
): Array<{ group: GlobalSearchGroup; rows: GlobalSearchRow[] }> => {
  const rows = globalSearchRows(state);
  return GROUP_ORDER.flatMap((group) => {
    const inGroup = rows.filter((row) => row.group === group);
    return inGroup.length > 0 ? [{ group, rows: inGroup }] : [];
  });
};

/** The entity a hit opens, for its deep link. */
export const hitEntity = (hit: Hit): EntityRef => {
  switch (hit.kind) {
    case "course":
      return { type: "course", id: hit.id };
    case "section":
      return { type: "section", id: hit.id, courseId: hit.courseId };
    case "lesson":
      return {
        type: "lesson",
        id: hit.id,
        courseId: hit.courseId,
        sectionId: hit.sectionId,
      };
    case "video":
      return hit.lessonId !== undefined
        ? {
            type: "video",
            id: hit.id,
            inLesson: {
              courseId: hit.courseId,
              sectionId: hit.sectionId,
              lessonId: hit.lessonId,
            },
          }
        : { type: "video", id: hit.id };
    case "pitch":
      return { type: "pitch", id: hit.id };
  }
};
