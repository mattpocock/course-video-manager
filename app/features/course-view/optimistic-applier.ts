import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  planLessonMove,
  planLessonsMove,
} from "@/services/lesson-move-planner";
import type {
  LoaderData,
  Lesson,
  Section,
  Segment,
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
    case "add-ghost-lesson":
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
    case "convert-to-ghost":
    case "create-on-disk":
    case "set-lesson-authoring-status":
      return event.lessonId;
    case "create-segment":
      return event.videoId;
    case "rename-segment":
    case "update-segment-description":
    case "set-segment-kind":
    case "delete-segment":
    case "move-segment":
      return event.segmentId;
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
        path: replaceSlug(section.path, event.title),
      }));
    case "update-section-description":
      return withPatchedSection(loaderData, event.sectionId, () => ({
        description: event.description,
      }));
    case "delete-lesson":
      return applyDeleteLesson(loaderData, event);
    case "archive-section":
      return applyArchiveSection(loaderData, event);
    case "convert-to-ghost":
      return applyConvertToGhost(loaderData, event);
    case "reorder-sections":
      return applyReorderSections(loaderData, event);
    case "reorder-lessons":
      return applyReorderLessons(loaderData, event);
    case "move-lesson-to-section":
      return applyMoveLessonToSection(loaderData, event);
    case "move-lessons-to-section":
      return applyMoveLessonsToSection(loaderData, event);
    case "rename-segment":
      return withPatchedSegment(loaderData, event.segmentId, () => ({
        title: event.title,
      }));
    case "update-segment-description":
      return withPatchedSegment(loaderData, event.segmentId, () => ({
        description: event.description,
      }));
    case "set-segment-kind":
      return withPatchedSegment(loaderData, event.segmentId, () => ({
        kind: event.kind,
      }));
    case "delete-segment":
      return applyDeleteSegment(loaderData, event.segmentId);
    case "move-segment":
      return applyMoveSegment(loaderData, event);
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

function applyConvertToGhost(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "convert-to-ghost" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  let found = false;
  const sections = course.sections.map((section) => {
    if (found) return section;
    let sectionChanged = false;
    const lessons = section.lessons.map((lesson) => {
      if (lesson.id === event.lessonId) {
        found = true;
        sectionChanged = true;
        return { ...lesson, fsStatus: "ghost" as const };
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
      fsStatus: l.fsStatus,
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

  // Patch a lesson's path/order from the plan; section membership is encoded by
  // which section array the lesson sits in, so it isn't patched here.
  const patch = (l: Lesson): Lesson => {
    const u = lessonUpdateById.get(l.id);
    return u ? { ...l, path: u.path, order: u.order } : l;
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
    selectedCourse: { ...course, sections },
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
 * Patch a single Segment in place, walking sections → lessons → videos →
 * segments and rebuilding only the branches that change (reference equality is
 * preserved for everything else, like the lesson/section helpers).
 */
function withPatchedSegment(
  loaderData: LoaderData,
  segmentId: string,
  patchFn: (segment: Segment) => Partial<Segment>
): LoaderData {
  return withMappedVideoSegments(loaderData, (video) => {
    const idx = video.segments.findIndex((s) => s.id === segmentId);
    if (idx === -1) return null;
    const segments = video.segments.map((s) =>
      s.id === segmentId ? { ...s, ...patchFn(s) } : s
    );
    return { ...video, segments };
  });
}

function applyDeleteSegment(
  loaderData: LoaderData,
  segmentId: string
): LoaderData {
  return withMappedVideoSegments(loaderData, (video) => {
    if (!video.segments.some((s) => s.id === segmentId)) return null;
    return {
      ...video,
      segments: video.segments.filter((s) => s.id !== segmentId),
    };
  });
}

/**
 * Move a Segment within or across Videos: drop it from its source Video and
 * splice it into the target before `beforeSegmentId` (or append). Display order
 * is array order; the server recomputes the fractional key on revalidation.
 */
/**
 * Unlike `reorder-lessons` (which carries the full ordered id list, per ADR
 * 0002), a segment move carries a single `beforeSegmentId` anchor — deliberately
 * mirroring the cross-parent lesson move (ADR 0011/0013) since a move can
 * reassign the segment to a different Video. The applier splices the moved
 * segment in front of that anchor (or appends when null).
 */
function applyMoveSegment(
  loaderData: LoaderData,
  event: Extract<CourseEditorEvent, { type: "move-segment" }>
): LoaderData {
  const course = loaderData.selectedCourse;
  if (!course) return loaderData;

  const { segmentId, targetVideoId } = event;
  const beforeSegmentId = event.beforeSegmentId ?? null;

  // Find the segment being moved across all videos.
  let moved: Segment | undefined;
  for (const section of course.sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        const found = video.segments.find((s) => s.id === segmentId);
        if (found) moved = found;
      }
    }
  }
  if (!moved) return loaderData;

  const movedInTarget: Segment = { ...moved, videoId: targetVideoId };

  const remapVideo = (video: Video): Video => {
    const isSource = video.segments.some((s) => s.id === segmentId);
    const isTarget = video.id === targetVideoId;
    if (!isSource && !isTarget) return video;

    let segments = video.segments.filter((s) => s.id !== segmentId);
    if (isTarget) {
      const idx =
        beforeSegmentId !== null
          ? segments.findIndex((s) => s.id === beforeSegmentId)
          : -1;
      segments =
        idx === -1
          ? [...segments, movedInTarget]
          : [...segments.slice(0, idx), movedInTarget, ...segments.slice(idx)];
    }
    return { ...video, segments };
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
function withMappedVideoSegments(
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
