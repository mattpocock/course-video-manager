import type { Lesson } from "./course-view-types";

export function filterLessons(
  lessons: Lesson[],
  opts: {
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string | null;
    searchQuery: string;
  }
): { filteredLessons: Lesson[]; hasActiveFilters: boolean } {
  const { priorityFilter, iconFilter, fsStatusFilter, searchQuery } = opts;
  const hasActiveFilters =
    priorityFilter.length > 0 ||
    iconFilter.length > 0 ||
    fsStatusFilter !== null ||
    searchQuery.length > 0;

  if (!hasActiveFilters) return { filteredLessons: lessons, hasActiveFilters };

  const filteredLessons = lessons.filter((lesson) => {
    const passesPriorityFilter =
      priorityFilter.length === 0 ||
      priorityFilter.includes(lesson.priority ?? 2);
    const passesIconFilter =
      iconFilter.length === 0 || iconFilter.includes(lesson.icon ?? "watch");
    const passesFsStatusFilter = (() => {
      if (fsStatusFilter === null) return true;
      if (fsStatusFilter === "ghost")
        return (lesson.fsStatus ?? "real") === "ghost";
      if (fsStatusFilter === "real")
        return (lesson.fsStatus ?? "real") === "real";
      // "todo" filter
      if ((lesson.fsStatus ?? "real") !== "real") return false;
      return lesson.authoringStatus === "todo";
    })();
    const passesSearch = (() => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      if (lesson.path.toLowerCase().includes(q)) return true;
      if (lesson.title?.toLowerCase().includes(q)) return true;
      if (lesson.description?.toLowerCase().includes(q)) return true;
      return lesson.videos.some((v) => v.path.toLowerCase().includes(q));
    })();
    return (
      passesPriorityFilter &&
      passesIconFilter &&
      passesFsStatusFilter &&
      passesSearch
    );
  });

  return { filteredLessons, hasActiveFilters };
}

// Dependency Group connections. Walks a section's lessons in display order and
// marks, for each adjacent pair, whether they belong to the same contiguous
// Dependency Group. Lesson i connects to lesson i-1 iff it has a *direct*
// dependency on any member of the current running group (lessons groupStart..i-1).
// A lesson with no such link closes the current group and starts a fresh one.
// Directed-backward, contiguous-only, within-section. The caller must suppress
// grouping when a search/filter is active. See CONTEXT.md / docs/adr/0010.
export function computeDependencyGroupConnections(
  lessons: Lesson[]
): Record<string, { connectsToPrev: boolean }> {
  const result: Record<string, { connectsToPrev: boolean }> = {};
  for (const lesson of lessons) {
    result[lesson.id] = { connectsToPrev: false };
  }

  let groupStart = 0;
  for (let i = 1; i < lessons.length; i++) {
    const current = lessons[i]!;
    const deps = current.dependencies ?? [];
    const members = new Set(lessons.slice(groupStart, i).map((l) => l.id));
    if (deps.some((d) => members.has(d))) {
      result[current.id]!.connectsToPrev = true;
    } else {
      groupStart = i;
    }
  }

  return result;
}

// Segment a section's lessons into contiguous runs. A run of length > 1 is a
// Dependency Group; length 1 is a lone lesson. `startIndex` is the lesson's
// position in the original list (used to recover its lessonIndex).
export function groupIntoRuns(
  lessons: Lesson[],
  connections: Record<string, { connectsToPrev: boolean }>
): { lessons: Lesson[]; startIndex: number }[] {
  const runs: { lessons: Lesson[]; startIndex: number }[] = [];
  lessons.forEach((lesson, i) => {
    const last = runs[runs.length - 1];
    if (last && connections[lesson.id]?.connectsToPrev) {
      last.lessons.push(lesson);
    } else {
      runs.push({ lessons: [lesson], startIndex: i });
    }
  });
  return runs;
}

// Combines the two steps a section needs to render its Dependency Group spine:
// the contiguous runs (for spacing) and the adjacent connected pairs (for the
// measured overlay). `enabled` is false in expanded view or under an active
// filter, in which case every lesson is its own run and no pairs are produced.
export function computeSectionDependencyRuns(
  lessons: Lesson[],
  filteredLessons: Lesson[],
  enabled: boolean
): {
  runs: { lessons: Lesson[]; startIndex: number }[];
  spinePairs: [string, string][];
  revalidateKey: string;
} {
  const connections = enabled ? computeDependencyGroupConnections(lessons) : {};
  const runs = groupIntoRuns(filteredLessons, connections);
  const spinePairs: [string, string][] = [];
  filteredLessons.forEach((lesson, i) => {
    if (i > 0 && connections[lesson.id]?.connectsToPrev) {
      spinePairs.push([filteredLessons[i - 1]!.id, lesson.id]);
    }
  });
  // Hash of the full rendered items. The measured spine re-validates whenever
  // this changes, so any edit that moves an icon re-measures even when it leaves
  // spinePairs identical and the container's box unchanged: an in-place reorder,
  // a title edit that rewraps a row, a dependency change, etc. See docs/adr/0010.
  const revalidateKey = JSON.stringify(filteredLessons);
  return { runs, spinePairs, revalidateKey };
}

export function computeSectionSwap(
  sectionIds: string[],
  sectionId: string,
  direction: "up" | "down"
): string[] | null {
  const idx = sectionIds.indexOf(sectionId);
  if (idx === -1) return null;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sectionIds.length) return null;
  const result = [...sectionIds];
  result[idx] = sectionIds[swapIdx]!;
  result[swapIdx] = sectionIds[idx]!;
  return result;
}

export function calcSectionDuration(lessons: Lesson[]): number {
  return lessons.reduce(
    (acc, lesson) =>
      acc +
      lesson.videos.reduce(
        (videoAcc, video) => videoAcc + video.totalDuration,
        0
      ),
    0
  );
}
