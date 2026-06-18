import { sections, lessons, videos } from "@/db/schema";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { DrizzleDB } from "@/services/drizzle-service.server";

function suffixPath(path: string, suffix: number): string {
  const dotIdx = path.lastIndexOf(".");
  if (dotIdx > 0) {
    return `${path.slice(0, dotIdx)}-${suffix}${path.slice(dotIdx)}`;
  }
  return `${path}-${suffix}`;
}

export async function backfillSectionPaths(db: DrizzleDB) {
  const allSections = await db
    .select({
      id: sections.id,
      path: sections.path,
      repoVersionId: sections.repoVersionId,
      order: sections.order,
      createdAt: sections.createdAt,
    })
    .from(sections)
    .where(isNull(sections.archivedAt));

  allSections.sort((a, b) => {
    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) return orderDiff;
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const usedByScope = new Map<string, Set<string>>();

  for (const section of allSections) {
    const scope = section.repoVersionId;
    if (!usedByScope.has(scope)) usedByScope.set(scope, new Set());
    const used = usedByScope.get(scope)!;

    let path = section.path;
    if (used.has(path)) {
      let suffix = 2;
      while (used.has(suffixPath(path, suffix))) suffix++;
      const newPath = suffixPath(path, suffix);
      await db
        .update(sections)
        .set({ path: newPath })
        .where(eq(sections.id, section.id));
      used.add(newPath);
    } else {
      used.add(path);
    }
  }
}

export async function backfillLessonPaths(db: DrizzleDB) {
  const allLessons = await db
    .select({
      id: lessons.id,
      path: lessons.path,
      sectionId: lessons.sectionId,
      order: lessons.order,
      createdAt: lessons.createdAt,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  allLessons.sort((a, b) => {
    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) return orderDiff;
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const usedByScope = new Map<string, Set<string>>();

  for (const lesson of allLessons) {
    const scope = lesson.sectionId;
    if (!usedByScope.has(scope)) usedByScope.set(scope, new Set());
    const used = usedByScope.get(scope)!;

    let path = lesson.path;
    if (used.has(path)) {
      let suffix = 2;
      while (used.has(`${path}-${suffix}`)) suffix++;
      const newPath = `${path}-${suffix}`;
      await db
        .update(lessons)
        .set({ path: newPath })
        .where(eq(lessons.id, lesson.id));
      used.add(newPath);
    } else {
      used.add(path);
    }
  }
}

export async function backfillVideoPaths(db: DrizzleDB) {
  const allVideos = await db
    .select({
      id: videos.id,
      path: videos.path,
      lessonId: videos.lessonId,
      createdAt: videos.createdAt,
    })
    .from(videos)
    .where(and(eq(videos.archived, false), isNotNull(videos.lessonId)));

  allVideos.sort((a, b) => {
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const usedByScope = new Map<string, Set<string>>();

  for (const video of allVideos) {
    const scope = video.lessonId!;
    if (!usedByScope.has(scope)) usedByScope.set(scope, new Set());
    const used = usedByScope.get(scope)!;

    let path = video.path;
    if (used.has(path)) {
      let suffix = 2;
      while (used.has(suffixPath(path, suffix))) suffix++;
      const newPath = suffixPath(path, suffix);
      await db
        .update(videos)
        .set({ path: newPath })
        .where(eq(videos.id, video.id));
      used.add(newPath);
    } else {
      used.add(path);
    }
  }
}
