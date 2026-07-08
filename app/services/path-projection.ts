import {
  sectionHasRealLessons,
  deriveSectionPath,
} from "./section-path-service";
import { deriveLessonPath } from "./lesson-path-service";

export { deriveLessonPath } from "./lesson-path-service";
export { deriveSectionPath } from "./section-path-service";

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

export const projectVersionPaths = (
  sections: readonly ProjectableSection[]
): Map<string, DerivedPath> => {
  const paths = new Map<string, DerivedPath>();

  const realSections = sections.filter((s) => sectionHasRealLessons(s.lessons));
  const sectionRanks = rankByOrder(realSections);

  for (const section of realSections) {
    const sectionNumber = sectionRanks.get(section.id)!;
    paths.set(section.id, deriveSectionPath(section.title, sectionNumber));

    const lessonRanks = rankByOrder(section.lessons);

    for (const lesson of section.lessons) {
      const lessonNumber = lessonRanks.get(lesson.id)!;
      paths.set(
        lesson.id,
        deriveLessonPath(lesson.title, sectionNumber, lessonNumber)
      );
    }
  }

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

const ghostFallback = (entity: { title: string }): DerivedPath => entity.title;

export const attachDerivedPaths = <S extends ProjectableSection>(
  sections: readonly S[]
): SectionWithPath<S>[] => {
  const paths = projectVersionPaths(sections);

  return sections.map((section) => ({
    ...section,
    path: paths.get(section.id) ?? ghostFallback(section),
    lessons: section.lessons.map((lesson) => ({
      ...lesson,
      path: paths.get(lesson.id) ?? ghostFallback(lesson),
    })),
  })) as SectionWithPath<S>[];
};
