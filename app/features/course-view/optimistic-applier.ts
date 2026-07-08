import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  planLessonMove,
  planLessonsMove,
} from "@/services/lesson-move-planner";
import { attachDerivedPaths } from "@/services/path-projection";
import { toSlug } from "@/services/lesson-path-service";
import type {
  LoaderData,
  Lesson,
  Section,
  Beat,
  Video,
} from "./course-view-types";

/**
 * Fetcher key convention: `course-editor:<event-type>:<entity-id>`.
 *
 * Two mutations on the same entity + event type share a key (only the
 * latest intent is visible); different entities get separate fetcher slots.
 */
export function courseEditorFetcherKey(
  eventType: string,
  entityId: string
): string {
  return `course-editor:${eventType}:${entityId}`;
}

export const COURSE_EDITOR_KEY_PREFIX = "course-editor:";
export const DELETE_VIDEO_KEY_PREFIX = "delete-video:";

export function deleteVideoFetcherKey(videoId: string): string {
  return `${DELETE_VIDEO_KEY_PREFIX}${videoId}`;
}

export function courseEditorFetcherKeyForEvent(
  event: CourseEditorEvent
): string {
  const id = entityIdForEvent(event);
  return courseEditorFetcherKey(event.type, id);
}

function entityIdForEvent(event: CourseEditorEvent): string {
  switch (event.type) {
    case "create-section":
      return event.repoVersionId;
    case "update-section-name":
    case "update-section-description":
    case "archive-section":
      return event.sectionId;
    case "reorder-sections":
      return "batch";
    case "reorder-lessons":
      return event.sectionId;
    case "move-lessons-to-section":
      return event.targetSectionId;
    case "add-lesson":
    case "create-real-lesson":
      return event.sectionId;
    case "update-lesson-name":
    case "update-lesson-title":
    case "update-lesson-description":
    case "update-lesson-icon":
    case "update-lesson-priority":
    case "update-lesson-dependencies":
    case "delete-lesson":
    case "move-lesson-to-section":
    case "set-lesson-authoring-status":
      return event.lessonId;
    case "create-beat":
      return event.videoId;
    case "rename-beat":
    case "update-beat-description":
    case "set-beat-kind":
    case "delete-beat":
    case "move-beat":
      return event.beatId;
  }
}

export function applyOptimisticEvent(
  loaderData: LoaderData,
  event: CourseEditorEvent
): LoaderData {
  switch (event.type) {
    case "update-lesson-icon":
      return withPatchedLesson(loaderData, event.lessonId, () => ({
        icon: event.icon,
      }));
    case "update-lesson-title":
      return withPatchedLesson(loaderData, event.lessonId, () => ({
        title: event.title,
      }));
    case "update-lesson-name":
      return withPatchedLesson(loaderData, event.lessonId, (lesson) => ({
        path: replaceSlug(lesson.path, event.newSlug),
      }));
    case "update-lesson-description":
      return withPatchedLesson(loaderData, event.lessonId, () => ({
        description: event.description,
      }));
    case "update-lesson-priority":
      return withPatchedLesson(loaderData, event.lessonId, () => ({
        priority: event.priority,
      }));
    case "update-lesson-dependencies":
      return withPatchedLesson(loaderData, event.lessonId, () => ({
        dependencies: event.dependencies,
      }));
    case "set-lesson-authoring-status":
      return withPatchedLesson(loaderData, event.lessonId, () => ({
        authoringStatus: event.status,
      }));
    case "update-section-name":
      return withPatchedSection(loaderData, event.sectionId, (section) => ({
        title: event.title,
        path: replaceSlug(section.path, toSlug(event.title) || "untitled"),
      }));
    case "update-section-description":
      return withPatchedSection(loaderData, event.sectionId, () => ({
        description: event.description,
      }));
    case "delete-lesson":
      return applyDeleteLesson(loaderData, event);
    case "archive-section":
      return applyArchiveSection(loaderData, event);
    case "reorder-sections":
      return applyReorderSections(loaderData, event);
    case "reorder-lessons":
      return applyReorderLessons(loaderData, event);
    case "move-lesson-to-section":
      return applyMoveLessonToSection(loaderData, event);
    case "move-lessons-to-section":
      return applyMoveLessonsToSection(loaderData, event);
    case "rename-beat":
      return withPatchedBeat(loaderData, event.beatId, () => ({
        title: event.title,
      }));
    case "update-beat-description":
      return withPatchedBeat(loaderData, event.beatId, () => ({
        description: event.description,
      }));
    case "set-beat-kind":
      return withPatchedBeat(loaderData, event.beatId, () => ({
        kind: event.kind,
      }));
    case "delete-beat":
      return applyDeleteBeat(loaderData, event.beatId);
    case "move-beat":
      return applyMoveBeat(loaderData, event);
    default:
      return loaderData;
  }
}

function replaceSlug(path: string, newSlug: string): string {
  const match = path.match(/^(\d[\d.]*-)/);
  return match ? match[1] + newSlug : newSlug;
}

export function applyOptimisticDeleteVideo(
  loaderData: LoaderData,
  videoId: string
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  let found = false;
  const sections = course.sections.map((section) => {
    if (found) return section;
    let sectionChanged = false;
    const lessons = section.lessons.map((lesson) => {
      if (found) return lesson;
      const idx = lesson.videos.findIndex((v) => v.id === videoId);
      if (idx === -1) return lesson;
      found = true;
      sectionChanged = true;
      const videos = lesson.videos.filter((v) => v.id !== videoId);
      return { ...lesson, videos };
    });
    return sectionChanged ? { ...section, lessons } : section;
  });

  if (!found) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}

function applyArchiveSection(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "archive-section" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const filtered = course.sections.filter(
    (section) => section.id !== event.sectionId
  );

  if (filtered.length === course.sections.length) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections: filtered },
  };
}

function applyDeleteLesson(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "delete-lesson" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  let found = false;
  const sections = course.sections.map((section) => {
    if (found) return section;
    const filtered = section.lessons.filter((lesson) => {
      if (lesson.id === event.lessonId) {
        found = true;
        return false;
      }
      return true;
    });
    return filtered.length !== section.lessons.length
      ? { ...section, lessons: filtered }
      : section;
  });

  if (!found) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}

function applyReorderSections(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "reorder-sections" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const { sectionIds } = event;
  if (sectionIds.length === 0) return loaderData;

  const sectionMap = new Map(course.sections.map((s) => [s.id, s]));
  const ordered: typeof course.sections = [];

  for (const id of sectionIds) {
    const section = sectionMap.get(id);
    if (section) {
      ordered.push(section);
      sectionMap.delete(id);
    }
  }

  for (const section of sectionMap.values()) {
    ordered.push(section);
  }

  if (ordered.every((s, i) => s === course.sections[i])) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections: ordered },
  };
}

function applyReorderLessons(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "reorder-lessons" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const sectionIndex = course.sections.findIndex(
    (s) => s.id === event.sectionId
  );
  if (sectionIndex === -1) return loaderData;

  const section = course.sections[sectionIndex]!;
  const { lessonIds } = event;

  const lessonMap = new Map(section.lessons.map((l) => [l.id, l]));
  const ordered: typeof section.lessons = [];

  for (const id of lessonIds) {
    const lesson = lessonMap.get(id);
    if (lesson) {
      ordered.push(lesson);
      lessonMap.delete(id);
    }
  }

  for (const lesson of lessonMap.values()) {
    ordered.push(lesson);
  }

  if (ordered.every((l, i) => l === section.lessons[i])) return loaderData;

  const sections = course.sections.map((s, i) =>
    i === sectionIndex ? { ...s, lessons: ordered } : s
  );

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}

/** Course sections in the shape the move planners expect. */
function toPlannerSections(course: NonNullable<LoaderData["selectedCourse"]>) {
  return course.sections.map((s) => ({
    id: s.id,
    path: s.path,
    lessons: s.lessons.map((l) => ({
      id: l.id,
      path: l.path,
      order: l.order,
    })),
  }));
}

function applyMoveLessonToSection(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "move-lesson-to-section" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const beforeLessonId = event.beforeLessonId ?? null;
  const plan = planLessonMove({
    sections: toPlannerSections(course),
    lessonId: event.lessonId,
    targetSectionId: event.targetSectionId,
    beforeLessonId,
  });

  return applyMovePlanToLoader(
    loaderData,
    plan,
    [event.lessonId],
    event.targetSectionId,
    beforeLessonId
  );
}

function applyMoveLessonsToSection(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "move-lessons-to-section" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const beforeLessonId = event.beforeLessonId ?? null;
  const plan = planLessonsMove({
    sections: toPlannerSections(course),
    lessonIds: event.lessonIds,
    targetSectionId: event.targetSectionId,
    beforeLessonId,
  });

  return applyMovePlanToLoader(
    loaderData,
    plan,
    event.lessonIds,
    event.targetSectionId,
    beforeLessonId
  );
}

/**
 * Replay a move plan onto loader data. The moved lessons are dropped from their
 * current sections and re-inserted as one contiguous block (in
 * `orderedLessonIds` order) at the drop anchor in the target; every other
 * lesson/section is patched per the plan's path/order/renumber deltas.
 * Untouched sections keep their reference so the measured dep-group spine
 * avoids re-measuring. See docs/adr/0011-shared-lesson-move-planner.md and
 * docs/adr/0012-bulk-lesson-reorder-within-section.md.
 */
function applyMovePlanToLoader(
  loaderData: LoaderData,
  plan: ReturnType<typeof planLessonMove>,
  orderedLessonIds: string[],
  targetSectionId: string,
  beforeLessonId: string | null
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course || plan.noop) return loaderData;

  const lessonUpdateById = new Map(plan.lessonUpdates.map((u) => [u.id, u]));
  const sectionPathById = new Map(
    plan.sectionUpdates.map((u) => [u.id, u.path])
  );

  // Lessons that actually landed in the target, in insertion order.
  const movedIds = orderedLessonIds.filter(
    (id) => lessonUpdateById.get(id)?.sectionId === targetSectionId
  );
  const movedSet = new Set(movedIds);

  const patch = (l: Lesson): Lesson => {
    const u = lessonUpdateById.get(l.id);
    return u ? { ...l, order: u.order } : l;
  };

  const allLessons = course.sections.flatMap((s) => s.lessons);
  const movedBlock = movedIds
    .map((id) => allLessons.find((l) => l.id === id))
    .filter((l): l is Lesson => Boolean(l))
    .map(patch);

  const sections = course.sections.map((section) => {
    const hadMoved = section.lessons.some((l) => movedSet.has(l.id));
    const isTarget = section.id === targetSectionId;
    const newPath = sectionPathById.get(section.id);
    const hasPatchedLesson = section.lessons.some(
      (l) => !movedSet.has(l.id) && lessonUpdateById.has(l.id)
    );
    // Sections the cascade doesn't touch keep their reference.
    if (!hadMoved && !isTarget && newPath === undefined && !hasPatchedLesson) {
      return section;
    }

    // Drop the moved lessons from wherever they currently live.
    let lessons = section.lessons.filter((l) => !movedSet.has(l.id));

    // Insert the moved block into the target at the drop anchor (display order
    // = array order; null/missing anchor appends), matching the insertion line.
    if (isTarget) {
      const idx =
        beforeLessonId !== null
          ? lessons.findIndex((l) => l.id === beforeLessonId)
          : -1;
      lessons =
        idx === -1
          ? [...lessons, ...movedBlock]
          : [...lessons.slice(0, idx), ...movedBlock, ...lessons.slice(idx)];
    }

    // Apply path/order patches to the rest (source renumber, target shifts).
    lessons = lessons.map((l) => (movedSet.has(l.id) ? l : patch(l)));

    return newPath !== undefined
      ? { ...section, path: newPath, lessons }
      : { ...section, lessons };
  });

  return {
    ...loaderData,
    selectedCourse: { ...course, sections: attachDerivedPaths(sections) },
  };
}

function withPatchedLesson(
  loaderData: LoaderData,
  lessonId: string,
  patchFn: (lesson: Lesson) => Partial<Lesson>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  let found = false;
  const sections = course.sections.map((section) => {
    if (found) return section;
    let sectionChanged = false;
    const lessons = section.lessons.map((lesson) => {
      if (lesson.id === lessonId) {
        found = true;
        sectionChanged = true;
        return { ...lesson, ...patchFn(lesson) };
      }
      return lesson;
    });
    return sectionChanged ? { ...section, lessons } : section;
  });

  if (!found) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}

/**
 * Patch a single Beat in place, walking sections → lessons → videos →
 * beats and rebuilding only the branches that change (reference equality is
 * preserved for everything else, like the lesson/section helpers).
 */
function withPatchedBeat(
  loaderData: LoaderData,
  beatId: string,
  patchFn: (beat: Beat) => Partial<Beat>
): LoaderData {
  return withMappedVideoBeats(loaderData, (video) => {
    const idx = video.beats.findIndex((s) => s.id === beatId);
    if (idx === -1) return null;
    const beats = video.beats.map((s) =>
      s.id === beatId ? { ...s, ...patchFn(s) } : s
    );
    return { ...video, beats };
  });
}

function applyDeleteBeat(loaderData: LoaderData, beatId: string): LoaderData {
  return withMappedVideoBeats(loaderData, (video) => {
    if (!video.beats.some((s) => s.id === beatId)) return null;
    return {
      ...video,
      beats: video.beats.filter((s) => s.id !== beatId),
    };
  });
}

/**
 * Move a Beat within or across Videos: drop it from its source Video and
 * splice it into the target before `beforeBeatId` (or append). Display order
 * is array order; the server recomputes the fractional key on revalidation.
 */
/**
 * Unlike `reorder-lessons` (which carries the full ordered id list, per ADR
 * 0002), a beat move carries a single `beforeBeatId` anchor — deliberately
 * mirroring the cross-parent lesson move (ADR 0011/0013) since a move can
 * reassign the beat to a different Video. The applier splices the moved
 * beat in front of that anchor (or appends when null).
 */
function applyMoveBeat(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "move-beat" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const { beatId, targetVideoId } = event;
  const beforeBeatId = event.beforeBeatId ?? null;

  // Find the beat being moved across all videos.
  let moved: Beat | undefined;
  for (const section of course.sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        const found = video.beats.find((s) => s.id === beatId);
        if (found) moved = found;
      }
    }
  }
  if (!moved) return loaderData;

  const movedInTarget: Beat = { ...moved, videoId: targetVideoId };

  const remapVideo = (video: Video): Video => {
    const isSource = video.beats.some((s) => s.id === beatId);
    const isTarget = video.id === targetVideoId;
    if (!isSource && !isTarget) return video;

    let beats = video.beats.filter((s) => s.id !== beatId);
    if (isTarget) {
      const idx =
        beforeBeatId !== null
          ? beats.findIndex((s) => s.id === beforeBeatId)
          : -1;
      beats =
        idx === -1
          ? [...beats, movedInTarget]
          : [...beats.slice(0, idx), movedInTarget, ...beats.slice(idx)];
    }
    return { ...video, beats };
  };

  let changed = false;
  const sections = course.sections.map((section) => {
    let sectionChanged = false;
    const lessons = section.lessons.map((lesson) => {
      let lessonChanged = false;
      const videos = lesson.videos.map((video) => {
        const next = remapVideo(video);
        if (next !== video) {
          lessonChanged = true;
          sectionChanged = true;
          changed = true;
        }
        return next;
      });
      return lessonChanged ? { ...lesson, videos } : lesson;
    });
    return sectionChanged ? { ...section, lessons } : section;
  });

  if (!changed) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}

/**
 * Walk to the first Video whose `mapVideo` returns a changed video (non-null)
 * and rebuild just that branch. Returns `loaderData` unchanged if no video is
 * touched, so unrelated sections keep their reference.
 */
function withMappedVideoBeats(
  loaderData: LoaderData,
  mapVideo: (video: Video) => Video | null
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  let found = false;
  const sections = course.sections.map((section) => {
    if (found) return section;
    let sectionChanged = false;
    const lessons = section.lessons.map((lesson) => {
      if (found) return lesson;
      let lessonChanged = false;
      const videos = lesson.videos.map((video) => {
        if (found) return video;
        const next = mapVideo(video);
        if (next === null) return video;
        found = true;
        lessonChanged = true;
        return next;
      });
      if (!lessonChanged) return lesson;
      sectionChanged = true;
      return { ...lesson, videos };
    });
    return sectionChanged ? { ...section, lessons } : section;
  });

  if (!found) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}

function withPatchedSection(
  loaderData: LoaderData,
  sectionId: string,
  patchFn: (section: Section) => Partial<Section>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  let found = false;
  const sections = course.sections.map((section) => {
    if (section.id === sectionId) {
      found = true;
      return { ...section, ...patchFn(section) };
    }
    return section;
  });

  if (!found) return loaderData;

  return {
    ...loaderData,
    selectedCourse: { ...course, sections },
  };
}
