import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Section } from "./course-view-types";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";

type DragItem = {
  id: string;
  title?: string | null;
  path: string;
  dependencies?: string[] | null;
};

/**
 * Section reorder handler. Dependency-order violations are not blocked or
 * toasted here — the per-lesson order-violation lint surfaces them after the
 * fact. See docs/adr/0011-shared-lesson-move-planner.md (harmonised channel).
 */
export function createSectionDragHandler(
  submitEvent: (event: CourseEditorEvent) => void
) {
  return (
      sections: { id: string; lessons: DragItem[] }[],
      _repoVersionId: string
    ) =>
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fromIndex = sections.findIndex((s) => s.id === active.id);
      const toIndex = sections.findIndex((s) => s.id === over.id);
      if (fromIndex === -1 || toIndex === -1) return;

      const newOrder = arrayMove(sections, fromIndex, toIndex);

      submitEvent({
        type: "reorder-sections",
        sectionIds: newOrder.map((s) => s.id),
      });
    };
}

type DropSection = { id: string; lessons: { id: string }[] };

export type LessonDrop = {
  targetSectionId: string;
  /** Insert before this lesson; `null` appends to the end of the target. */
  beforeLessonId: string | null;
};

/**
 * Resolve a lesson drag into a target section + drop anchor.
 *
 * - Dropping over a section container (e.g. an empty section) appends.
 * - Dropping over a lesson inserts before or after it, decided by whether the
 *   dragged card's centre is above or below the hovered lesson's centre.
 */
export function resolveLessonDrop(
  event: DragEndEvent | DragOverEvent,
  sections: DropSection[]
): LessonDrop | null {
  const { active, over } = event;
  if (!over) return null;

  const overId = String(over.id);

  const overSection = sections.find((s) => s.id === overId);
  if (overSection) {
    return { targetSectionId: overSection.id, beforeLessonId: null };
  }

  const overSec = sections.find((s) => s.lessons.some((l) => l.id === overId));
  if (!overSec) return null;

  const overIndex = overSec.lessons.findIndex((l) => l.id === overId);
  const activeRect = active.rect.current.translated;
  const insertBefore = activeRect
    ? activeRect.top + activeRect.height / 2 <
      over.rect.top + over.rect.height / 2
    : true;

  const beforeLessonId = insertBefore
    ? overId
    : (overSec.lessons[overIndex + 1]?.id ?? null);

  return { targetSectionId: overSec.id, beforeLessonId };
}

/**
 * New lesson-id ordering for a within-section reorder, or `null` if the drop
 * leaves the order unchanged (or anchors the lesson on itself).
 */
export function computeReorderIds(
  lessons: { id: string }[],
  lessonId: string,
  beforeLessonId: string | null
): string[] | null {
  if (beforeLessonId === lessonId) return null;

  const ids = lessons.map((l) => l.id);
  const without = ids.filter((id) => id !== lessonId);
  let insertAt = beforeLessonId
    ? without.indexOf(beforeLessonId)
    : without.length;
  if (insertAt === -1) insertAt = without.length;

  const next = [
    ...without.slice(0, insertAt),
    lessonId,
    ...without.slice(insertAt),
  ];
  if (next.length === ids.length && next.every((id, i) => id === ids[i])) {
    return null;
  }
  return next;
}

/**
 * New lesson-id ordering after bulk-moving a selection to an anchor, or `null`
 * if the selection is already contiguous at that position (no-op).
 *
 * Selected lessons are spliced out and re-inserted as one contiguous block at
 * `beforeLessonId`, preserving their relative order within the original array.
 */
export function computeBulkReorderIds(
  lessons: { id: string }[],
  selectedIds: Set<string>,
  beforeLessonId: string | null
): string[] | null {
  const ids = lessons.map((l) => l.id);
  const selected = ids.filter((id) => selectedIds.has(id));
  const without = ids.filter((id) => !selectedIds.has(id));

  let insertAt: number;
  if (!beforeLessonId) {
    insertAt = without.length;
  } else if (!selectedIds.has(beforeLessonId)) {
    insertAt = without.indexOf(beforeLessonId);
    if (insertAt === -1) insertAt = without.length;
  } else {
    const anchorIdx = ids.indexOf(beforeLessonId);
    const successor = ids
      .slice(anchorIdx + 1)
      .find((id) => !selectedIds.has(id));
    insertAt = successor ? without.indexOf(successor) : without.length;
  }

  const next = [
    ...without.slice(0, insertAt),
    ...selected,
    ...without.slice(insertAt),
  ];

  if (next.length === ids.length && next.every((id, i) => id === ids[i])) {
    return null;
  }
  return next;
}

export function computeFsStatusCounts(
  sections: Section[],
  filters: {
    priorityFilter: number[];
    iconFilter: string[];
    searchQuery: string;
  }
) {
  const { priorityFilter, iconFilter, searchQuery } = filters;
  const counts = { ghost: 0, real: 0, todo: 0 };
  for (const section of sections) {
    for (const lesson of section.lessons) {
      const passesPriority =
        priorityFilter.length === 0 ||
        priorityFilter.includes(lesson.priority ?? 2);
      const passesIcon =
        iconFilter.length === 0 || iconFilter.includes(lesson.icon ?? "watch");
      if (!passesPriority || !passesIcon) continue;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesPath = lesson.path.toLowerCase().includes(q);
        const matchesTitle = lesson.title?.toLowerCase().includes(q);
        const matchesDesc = lesson.description?.toLowerCase().includes(q);
        const matchesVideo = lesson.videos.some((v) =>
          v.path.toLowerCase().includes(q)
        );
        if (!matchesPath && !matchesTitle && !matchesDesc && !matchesVideo)
          continue;
      }

      const status = lesson.fsStatus ?? "real";
      if (status === "ghost") {
        counts.ghost++;
      } else {
        counts.real++;
        if (lesson.authoringStatus === "todo") counts.todo++;
      }
    }
  }
  return counts;
}

export function computeCourseStats(
  sections: Section[],
  filePath: string | null
) {
  const isGhostCourse = filePath === null;

  const shouldCount = (lesson: Section["lessons"][number]) =>
    isGhostCourse ? lesson.fsStatus === "ghost" : lesson.fsStatus !== "ghost";

  let totalLessons = 0;
  let totalLessonsWithVideos = 0;
  let totalVideos = 0;
  let totalDurationSeconds = 0;

  for (const section of sections) {
    for (const lesson of section.lessons) {
      if (!shouldCount(lesson)) continue;
      totalLessons++;
      if (lesson.videos.length > 0) totalLessonsWithVideos++;
      totalVideos += lesson.videos.length;
      for (const video of lesson.videos) {
        totalDurationSeconds += video.totalDuration;
      }
    }
  }

  const percentageComplete =
    totalLessons > 0
      ? Math.round((totalLessonsWithVideos / totalLessons) * 100)
      : 0;

  return {
    totalLessons,
    totalLessonsWithVideos,
    totalVideos,
    totalDurationSeconds,
    percentageComplete,
  };
}

export function computeFlatLessons(sections: Section[]) {
  return sections.flatMap((section, sectionIdx) =>
    section.lessons.map((lesson, lessonIdx) => ({
      id: lesson.id,
      number: `${sectionIdx + 1}.${lessonIdx + 1}`,
      title:
        lesson.fsStatus === "ghost" ? lesson.title || lesson.path : lesson.path,
      sectionId: section.id,
      sectionTitle: section.path,
      sectionNumber: sectionIdx + 1,
    }))
  );
}

export function computeDependencyMap(sections: Section[]) {
  const map: Record<string, string[]> = {};
  for (const section of sections) {
    for (const lesson of section.lessons) {
      if (lesson.dependencies && lesson.dependencies.length > 0) {
        map[lesson.id] = lesson.dependencies;
      }
    }
  }
  return map;
}
