/**
 * Pure planner for moving a Lesson between Sections.
 *
 * Moving a real lesson is not an FK update — it renames the lesson's folder on
 * disk, renumbers the source section's remaining lessons to close the gap,
 * materializes a ghost target section, dematerializes a source section emptied
 * by the move, and renumbers every section's path prefix. The on-disk number
 * (`NN.MM-slug`) is positional and counts real lessons only, while the `order`
 * field orders ghost + real lessons together.
 *
 * This module computes that entire cascade as pure data. The server (in
 * `course-write-service.ts`) runs the planner, executes `fsOps` against the
 * git repo, and applies `lessonUpdates`/`sectionUpdates` to the database. The
 * client optimistic applier runs the SAME planner and applies the updates to
 * loader data, ignoring `fsOps`. One numbering algorithm, two consumers, no
 * drift. See docs/adr/0011-shared-lesson-move-planner.md.
 *
 * The `fsOps` are emitted in the same staged order the server has always used
 * (materialize → shift target → move lesson → renumber source → dematerialize
 * → renumber sections), so executing a plan reproduces the proven behaviour.
 */

import {
  buildLessonPath,
  computeInsertionPlan,
  parseLessonPath,
} from "./lesson-path-service";
import {
  buildSectionPath,
  parseSectionPath,
  sectionHasRealLessons,
  sectionSlugFromPath,
} from "./section-path-service";

/**
 * Title-cases a slug for the in-model path of a section that dematerialized
 * mid-move ("advanced-topics" → "Advanced Topics"). Local to this pure planner;
 * the shared lossy slug→title helper is deleted from the authoring model.
 */
const titleCaseFromSlug = (slug: string): string =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export type PlannerLesson = {
  id: string;
  path: string;
  order: number;
};

export type PlannerSection = {
  id: string;
  path: string;
  /** Lessons in display order (ascending `order`). */
  lessons: PlannerLesson[];
};

export type LessonMoveInput = {
  /** All sections of the version, in section order. */
  sections: PlannerSection[];
  lessonId: string;
  targetSectionId: string;
  /**
   * Drop anchor: place the moved lesson immediately before this lesson in the
   * target section. `null` appends to the end of the target.
   */
  beforeLessonId: string | null;
};

export type LessonUpdate = {
  id: string;
  sectionId: string;
  order: number;
};

export type SectionUpdate = {
  id: string;
  path: string;
};

export type FsOp =
  | { kind: "makeSectionDir"; sectionPath: string }
  | { kind: "deleteSectionDir"; sectionPath: string }
  | {
      kind: "moveLesson";
      sourceSectionPath: string;
      targetSectionPath: string;
      oldLessonDirName: string;
      newLessonDirName: string;
    }
  | {
      kind: "renameLessons";
      sectionPath: string;
      renames: { oldPath: string; newPath: string }[];
    }
  | {
      kind: "renameSections";
      renames: { oldPath: string; newPath: string }[];
    };

export type LessonMovePlan = {
  lessonUpdates: LessonUpdate[];
  sectionUpdates: SectionUpdate[];
  fsOps: FsOp[];
  /** True when the move is a no-op (lesson/target missing, or same section). */
  noop: boolean;
};

const NOOP: LessonMovePlan = {
  lessonUpdates: [],
  sectionUpdates: [],
  fsOps: [],
  noop: true,
};

/** Order value placing the moved lesson at the drop anchor in the target. */
function computeInsertOrder(
  targetLessons: PlannerLesson[],
  beforeLessonId: string | null,
  maxOrder: number
): number {
  if (beforeLessonId === null) return maxOrder + 1;
  const anchor = targetLessons.find((l) => l.id === beforeLessonId);
  if (!anchor) return maxOrder + 1;
  const predecessors = targetLessons.filter((l) => l.order < anchor.order);
  if (predecessors.length === 0) return anchor.order - 1;
  const predOrder = Math.max(...predecessors.map((l) => l.order));
  return (predOrder + anchor.order) / 2;
}

/** Index among the target's real lessons at which to insert the moved lesson. */
function computeInsertRealIndex(
  targetRealLessons: PlannerLesson[],
  targetLessons: PlannerLesson[],
  beforeLessonId: string | null
): number {
  if (beforeLessonId === null) return targetRealLessons.length;
  const anchor = targetLessons.find((l) => l.id === beforeLessonId);
  if (!anchor) return targetRealLessons.length;
  return targetRealLessons.filter((l) => l.order < anchor.order).length;
}

export function planLessonMove(input: LessonMoveInput): LessonMovePlan {
  const { sections, lessonId, targetSectionId, beforeLessonId } = input;

  // Deep clone into a working model we can mutate as we apply the cascade.
  const model = sections.map((s) => ({
    id: s.id,
    path: s.path,
    lessons: s.lessons.map((l) => ({ ...l })),
  }));

  const sourceSection = model.find((s) =>
    s.lessons.some((l) => l.id === lessonId)
  );
  const targetSection = model.find((s) => s.id === targetSectionId);
  if (!sourceSection || !targetSection) return NOOP;
  if (sourceSection.id === targetSectionId) return NOOP;

  const lesson = sourceSection.lessons.find((l) => l.id === lessonId)!;
  const targetLessons = targetSection.lessons;
  const maxOrder =
    targetLessons.length > 0
      ? Math.max(...targetLessons.map((l) => l.order))
      : 0;
  const newOrder = computeInsertOrder(targetLessons, beforeLessonId, maxOrder);

  const fsOps: FsOp[] = [];
  // Sections that currently have a directory on disk (real sections do).
  const hasDir = new Set(
    model.filter((s) => sectionHasRealLessons(s.lessons)).map((s) => s.id)
  );

  const sourceOldPath = sourceSection.path;
  const sourceParsed = parseSectionPath(sourceOldPath);
  const sourceSectionNumber = sourceParsed?.sectionNumber ?? 1;

  // Materialize a ghost target section: assign a provisional number from its
  // position among real sections, create its directory. renumberSections below
  // corrects the number once source realness is recomputed.
  const targetIsGhost = !sectionHasRealLessons(targetLessons);
  let targetSectionMaterialized = false;
  if (targetIsGhost) {
    const posIdx = model.findIndex((s) => s.id === targetSectionId);
    let realBefore = 0;
    for (let i = 0; i < posIdx; i++) {
      if (sectionHasRealLessons(model[i]!.lessons)) realBefore++;
    }
    const sectionNumber = realBefore + 1;
    targetSection.path = buildSectionPath(
      sectionNumber,
      sectionSlugFromPath(targetSection.path)
    );
    fsOps.push({ kind: "makeSectionDir", sectionPath: targetSection.path });
    hasDir.add(targetSection.id);
    targetSectionMaterialized = true;
  }
  const targetSectionNumber =
    parseSectionPath(targetSection.path)?.sectionNumber ?? 1;

  const lessonParsed = parseLessonPath(lesson.path);
  const slug = lessonParsed?.slug ?? lesson.path;

  const targetSortedLessons = [...targetLessons].sort(
    (a, b) => a.order - b.order
  );
  const insertAtIndex = computeInsertRealIndex(
    targetSortedLessons,
    targetLessons,
    beforeLessonId
  );
  const insertion = computeInsertionPlan({
    existingRealLessons: targetSortedLessons.map((l) => ({
      id: l.id,
      path: l.path,
    })),
    insertAtIndex,
    sectionNumber: targetSectionNumber,
    slug,
  });

  // Free the slot first (rename highest-numbered shifted lesson first so a
  // git mv never lands on a path still occupied), then move the lesson in.
  if (insertion.renames.length > 0) {
    const ordered = [...insertion.renames].reverse();
    fsOps.push({
      kind: "renameLessons",
      sectionPath: targetSection.path,
      renames: ordered.map((r) => ({ oldPath: r.oldPath, newPath: r.newPath })),
    });
    for (const r of insertion.renames) {
      const l = targetSection.lessons.find((x) => x.id === r.id);
      if (l) l.path = r.newPath;
    }
  }

  fsOps.push({
    kind: "moveLesson",
    sourceSectionPath: sourceOldPath,
    targetSectionPath: targetSection.path,
    oldLessonDirName: lesson.path,
    newLessonDirName: insertion.newLessonDirName,
  });

  // Move the lesson in the model: out of source, into target.
  sourceSection.lessons = sourceSection.lessons.filter(
    (l) => l.id !== lessonId
  );
  lesson.path = insertion.newLessonDirName;
  lesson.order = newOrder;
  targetSection.lessons.push(lesson);

  const sourceRealLessons = [...sourceSection.lessons].sort(
    (a, b) => a.order - b.order
  );
  if (sourceRealLessons.length > 0) {
    const sourceRenames: { oldPath: string; newPath: string }[] = [];
    for (let i = 0; i < sourceRealLessons.length; i++) {
      const l = sourceRealLessons[i]!;
      const p = parseLessonPath(l.path);
      if (!p) continue;
      const np = buildLessonPath(sourceSectionNumber, i + 1, p.slug);
      if (np !== l.path) {
        sourceRenames.push({ oldPath: l.path, newPath: np });
        l.path = np;
      }
    }
    if (sourceRenames.length > 0) {
      fsOps.push({
        kind: "renameLessons",
        sectionPath: sourceOldPath,
        renames: sourceRenames,
      });
    }
  }

  // If no real lessons remain in source, delete its dir and revert to ghost.
  let sourceDematerialized = false;
  if (sourceRealLessons.length === 0 && sourceParsed) {
    fsOps.push({ kind: "deleteSectionDir", sectionPath: sourceOldPath });
    sourceSection.path = titleCaseFromSlug(sourceParsed.slug);
    hasDir.delete(sourceSection.id);
    sourceDematerialized = true;
  }

  // Renumber all sections (and their lessons' prefixes) if realness changed.
  if (targetSectionMaterialized || sourceDematerialized) {
    renumberSectionsInModel(model, hasDir, fsOps);
  }

  return {
    lessonUpdates: diffLessons(sections, model),
    sectionUpdates: diffSections(sections, model),
    fsOps,
    noop: false,
  };
}

export type LessonsMoveInput = {
  /** All sections of the version, in section order. */
  sections: PlannerSection[];
  /**
   * Lessons to move, in the order they should land in the target. The caller
   * passes them in source display order so their relative order is preserved
   * and they land as one contiguous block at the drop anchor.
   */
  lessonIds: string[];
  targetSectionId: string;
  /** Drop anchor in the target; `null` appends. Never one of `lessonIds`. */
  beforeLessonId: string | null;
};

/**
 * Plan a bulk cross-section move by folding {@link planLessonMove} over the
 * selected lessons one at a time, threading the post-move model into the next
 * step. Each single move reuses the proven placement / renumbering /
 * materialize / dematerialize cascade; anchoring every lesson at the same
 * `beforeLessonId` and iterating in target order leaves them contiguous and in
 * order just before the anchor. fsOps from each step concatenate into one
 * sequentially-valid script. See
 * docs/adr/0012-bulk-lesson-reorder-within-section.md.
 */
export function planLessonsMove(input: LessonsMoveInput): LessonMovePlan {
  const { lessonIds, targetSectionId, beforeLessonId } = input;

  let model: PlannerSection[] = input.sections;
  const fsOps: FsOp[] = [];
  let moved = false;

  for (const lessonId of lessonIds) {
    const step = planLessonMove({
      sections: model,
      lessonId,
      targetSectionId,
      beforeLessonId,
    });
    if (step.noop) continue;
    moved = true;
    fsOps.push(...step.fsOps);
    model = applyPlanToModel(model, step);
  }

  if (!moved) return NOOP;

  return {
    lessonUpdates: diffLessons(input.sections, model),
    sectionUpdates: diffSections(input.sections, model),
    fsOps,
    noop: false,
  };
}

/**
 * Apply a single plan's data deltas to a planner model, returning the next
 * model (same section order, lessons re-sorted into display order).
 */
function applyPlanToModel(
  sections: PlannerSection[],
  plan: LessonMovePlan
): PlannerSection[] {
  const lessonUpdateById = new Map(plan.lessonUpdates.map((u) => [u.id, u]));
  const sectionPathById = new Map(
    plan.sectionUpdates.map((u) => [u.id, u.path])
  );

  const placed: { lesson: PlannerLesson; sectionId: string }[] = [];
  for (const s of sections) {
    for (const l of s.lessons) {
      const u = lessonUpdateById.get(l.id);
      placed.push({
        lesson: {
          ...l,
          order: u ? u.order : l.order,
        },
        sectionId: u ? u.sectionId : s.id,
      });
    }
  }

  return sections.map((s) => ({
    id: s.id,
    path: sectionPathById.get(s.id) ?? s.path,
    lessons: placed
      .filter((p) => p.sectionId === s.id)
      .map((p) => p.lesson)
      .sort((a, b) => a.order - b.order),
  }));
}

type WorkingSection = {
  id: string;
  path: string;
  lessons: PlannerLesson[];
};

/**
 * Real sections get sequential numbers, ghosts are skipped, and each
 * renumbered section's real lessons keep their own lessonNumber under the
 * new prefix.
 */
function renumberSectionsInModel(
  model: WorkingSection[],
  hasDir: Set<string>,
  fsOps: FsOp[]
): void {
  const sectionRenames: Array<{
    id: string;
    oldPath: string;
    newPath: string;
    newSectionNumber: number;
  }> = [];

  let realNumber = 0;
  for (const section of model) {
    if (!sectionHasRealLessons(section.lessons)) continue;
    realNumber++;
    const newPath = buildSectionPath(
      realNumber,
      sectionSlugFromPath(section.path)
    );
    if (newPath !== section.path) {
      sectionRenames.push({
        id: section.id,
        oldPath: section.path,
        newPath,
        newSectionNumber: realNumber,
      });
    }
  }

  if (sectionRenames.length === 0) return;

  const fsRenames = sectionRenames.filter((r) => hasDir.has(r.id));
  if (fsRenames.length > 0) {
    fsOps.push({
      kind: "renameSections",
      renames: fsRenames.map((r) => ({
        oldPath: r.oldPath,
        newPath: r.newPath,
      })),
    });
  }

  for (const rename of sectionRenames) {
    const section = model.find((s) => s.id === rename.id)!;
    section.path = rename.newPath;

    const realLessons = section.lessons;
    const lessonRenames: { oldPath: string; newPath: string }[] = [];
    for (const l of realLessons) {
      const p = parseLessonPath(l.path);
      if (!p) continue;
      const np = buildLessonPath(
        rename.newSectionNumber,
        p.lessonNumber,
        p.slug
      );
      if (np !== l.path) {
        lessonRenames.push({ oldPath: l.path, newPath: np });
        l.path = np;
      }
    }
    if (lessonRenames.length > 0) {
      fsOps.push({
        kind: "renameLessons",
        sectionPath: rename.newPath,
        renames: lessonRenames,
      });
    }
  }
}

function diffLessons(
  before: PlannerSection[],
  after: WorkingSection[]
): LessonUpdate[] {
  const beforeById = new Map<string, { sectionId: string; order: number }>();
  for (const s of before) {
    for (const l of s.lessons) {
      beforeById.set(l.id, { sectionId: s.id, order: l.order });
    }
  }

  const updates: LessonUpdate[] = [];
  for (const s of after) {
    for (const l of s.lessons) {
      const prev = beforeById.get(l.id);
      if (!prev || prev.sectionId !== s.id || prev.order !== l.order) {
        updates.push({
          id: l.id,
          sectionId: s.id,
          order: l.order,
        });
      }
    }
  }
  return updates;
}

function diffSections(
  before: PlannerSection[],
  after: WorkingSection[]
): SectionUpdate[] {
  const beforeById = new Map(before.map((s) => [s.id, s.path]));
  const updates: SectionUpdate[] = [];
  for (const s of after) {
    if (beforeById.get(s.id) !== s.path) {
      updates.push({ id: s.id, path: s.path });
    }
  }
  return updates;
}
