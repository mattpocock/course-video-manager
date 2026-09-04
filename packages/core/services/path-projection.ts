import {
  sectionHasLessons,
  deriveSectionPath,
} from "./section-path-service.js";
import { deriveLessonPath } from "./lesson-path-service.js";

export { deriveLessonPath } from "./lesson-path-service.js";
export { deriveSectionPath } from "./section-path-service.js";

export type DerivedPath = string;

type Rankable = { id: string; order: number };

export const rankByOrder = <T extends Rankable>(
  reals: readonly T[]
): Map<string, number> => {
  const sorted = [...reals].sort((a, b) =>
    a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)
  );
  const ranks = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    ranks.set(sorted[i]!.id, i + 1);
  }
  return ranks;
};

type ProjectableSection = {
  id: string;
  order: number;
  title: string;
  lessons: readonly ProjectableLesson[];
};

type ProjectableLesson = {
  id: string;
  order: number;
  title: string;
};

/**
 * First occurrence of a slug keeps it bare; each repeat gets a `-2`, `-3`, …
 * suffix, in the order `slugs` is iterated. Titles aren't required to be
 * unique among siblings (ADR 0018 only enforces `order`), but paths are
 * used as real directory names in the Dropbox bundle (ADR 0023), so two
 * same-titled siblings must not collide there.
 */
const dedupeSlugs = (slugs: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  return slugs.map((slug) => {
    const n = (counts.get(slug) ?? 0) + 1;
    counts.set(slug, n);
    return n === 1 ? slug : `${slug}-${n}`;
  });
};

export const projectVersionPaths = (
  sections: readonly ProjectableSection[]
): Map<string, DerivedPath> => {
  const paths = new Map<string, DerivedPath>();

  const sectionsWithLessons = sections.filter((s) =>
    sectionHasLessons(s.lessons)
  );
  const sectionRanks = rankByOrder(sectionsWithLessons);
  const orderedSections = [...sectionsWithLessons].sort(
    (a, b) => sectionRanks.get(a.id)! - sectionRanks.get(b.id)!
  );

  const sectionPaths = dedupeSlugs(
    orderedSections.map((s) => deriveSectionPath(s.title))
  );

  orderedSections.forEach((section, i) => {
    paths.set(section.id, sectionPaths[i]!);

    const lessonRanks = rankByOrder(section.lessons);
    const orderedLessons = [...section.lessons].sort(
      (a, b) => lessonRanks.get(a.id)! - lessonRanks.get(b.id)!
    );
    const lessonPaths = dedupeSlugs(
      orderedLessons.map((l) => deriveLessonPath(l.title))
    );
    orderedLessons.forEach((lesson, j) => {
      paths.set(lesson.id, lessonPaths[j]!);
    });
  });

  return paths;
};

type LessonWithPath<L extends ProjectableLesson> = Omit<L, "path"> & {
  path: DerivedPath;
};

type SectionWithPath<S extends ProjectableSection> = Omit<
  S,
  "path" | "lessons"
> & {
  path: DerivedPath;
  lessons: LessonWithPath<S["lessons"][number]>[];
};

const titleFallback = (entity: { title: string }): DerivedPath => entity.title;

export const attachDerivedPaths = <S extends ProjectableSection>(
  sections: readonly S[]
): SectionWithPath<S>[] => {
  const paths = projectVersionPaths(sections);

  return sections.map((section) => ({
    ...section,
    path: paths.get(section.id) ?? titleFallback(section),
    lessons: section.lessons.map((lesson) => ({
      ...lesson,
      path: paths.get(lesson.id) ?? titleFallback(lesson),
    })),
  })) as SectionWithPath<S>[];
};
