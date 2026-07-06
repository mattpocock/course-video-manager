import { sortByOrder } from "@/lib/sort-by-order";
import { sectionHasRealLessons } from "@/services/section-path-service";
import {
  computeVideoWarnings,
  type VideoWarning,
} from "@/services/video-warnings";
import type {
  ChapterLeaf,
  ClipLeaf,
  CourseLeaf,
  LessonLeaf,
  SectionLeaf,
  BeatLeaf,
  VideoLeaf,
} from "./vfs-schemas";

export type CourseInput = {
  id: string;
  name: string;
  memory: string;
};

export type VersionInput = {
  id: string;
  name: string;
  description: string;
};

export type SectionInput = {
  id: string;
  path: string;
  description: string;
  lessons: ReadonlyArray<{ fsStatus: string }>;
};

export type LessonInput = {
  id: string;
  path: string;
  title: string;
  description: string;
  icon: string | null;
  priority: number;
  dependencies: string[] | null;
  authoringStatus: string | null;
  fsStatus: string;
};

export type VideoInput = {
  id: string;
  path: string;
  originalFootagePath: string;
  clips: ReadonlyArray<{ order: string; archived: boolean }>;
  chapters: ReadonlyArray<{ order: string; archived: boolean }>;
};

export type BeatInput = {
  id: string;
  kind: string;
  title: string;
  description: string;
  order: string;
  archived?: boolean;
};

export type ClipInput = {
  id: string;
  order: string;
  text: string;
  sourceStartTime: number;
  sourceEndTime: number;
  videoFilename: string;
  pauseType: string;
  scene: string | null;
  profile: string | null;
  archived: boolean;
};

export type ChapterInput = {
  id: string;
  order: string;
  name: string;
  archived: boolean;
};

export const generateCourseLeaf = (
  course: CourseInput,
  version: VersionInput
): CourseLeaf => ({
  id: course.id,
  name: course.name,
  memory: course.memory,
  version: {
    id: version.id,
    name: version.name,
    description: version.description,
  },
});

export const generateSectionLeaf = (section: SectionInput): SectionLeaf => {
  const slugMatch = section.path.match(/^\d+-(.+)$/);
  const slug = slugMatch ? slugMatch[1]! : section.path;

  return {
    id: section.id,
    slug,
    description: section.description,
    real: sectionHasRealLessons(section.lessons),
  };
};

export const generateLessonLeaf = (lesson: LessonInput): LessonLeaf => {
  const slugMatch = lesson.path.match(/^\d+\.\d+-(.+)$/);
  const slug = slugMatch ? slugMatch[1]! : lesson.path;

  return {
    id: lesson.id,
    title: lesson.title,
    slug,
    description: lesson.description,
    icon: lesson.icon,
    priority: lesson.priority,
    dependencies: lesson.dependencies ?? [],
    authoringStatus:
      lesson.authoringStatus === "todo" || lesson.authoringStatus === "done"
        ? lesson.authoringStatus
        : null,
    fsStatus: lesson.fsStatus as "real" | "ghost",
  };
};

export const generateVideoLeaf = (video: VideoInput): VideoLeaf => {
  const warnings: VideoWarning[] = computeVideoWarnings({
    clips: video.clips as { order: string; archived: boolean }[],
    chapters: video.chapters as { order: string; archived: boolean }[],
  });

  return {
    id: video.id,
    name: video.path,
    originalFootagePath: video.originalFootagePath,
    warnings,
  };
};

export const generateSortedBeats = (
  beats: ReadonlyArray<BeatInput>
): BeatLeaf[] => {
  const live = beats.filter((s) => !s.archived);
  const sorted = sortByOrder(live.map((s) => ({ ...s })));

  return sorted.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    description: s.description,
  }));
};

export const generateSortedTimelineItems = (
  clips: ReadonlyArray<ClipInput>,
  chapters: ReadonlyArray<ChapterInput>
): Array<ClipLeaf | ChapterLeaf> => {
  const liveClips = clips.filter((c) => !c.archived);
  const liveChapters = chapters.filter((c) => !c.archived);

  type Orderable =
    | { type: "clip"; order: string; data: ClipInput }
    | { type: "chapter"; order: string; data: ChapterInput };

  const items: Orderable[] = [
    ...liveClips.map((c) => ({
      type: "clip" as const,
      order: c.order,
      data: c,
    })),
    ...liveChapters.map((c) => ({
      type: "chapter" as const,
      order: c.order,
      data: c,
    })),
  ];

  const sorted = sortByOrder(items);

  return sorted.map((item) => {
    if (item.type === "chapter") {
      const ch = item.data as ChapterInput;
      return { type: "chapter" as const, id: ch.id, name: ch.name };
    }
    const cl = item.data as ClipInput;
    return {
      type: "clip" as const,
      id: cl.id,
      text: cl.text,
      sourceStartTime: cl.sourceStartTime,
      sourceEndTime: cl.sourceEndTime,
      videoFilename: cl.videoFilename,
      pauseType: cl.pauseType,
      scene: cl.scene,
      profile: cl.profile,
    };
  });
};
