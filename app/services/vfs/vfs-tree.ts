import type {
  CourseLeaf,
  LessonLeaf,
  SectionLeaf,
  SegmentsLeaf,
  TimelineLeaf,
  VideoLeaf,
} from "./vfs-schemas";

export type VfsLeafNode = {
  kind: "file";
  name: string;
  data:
    | CourseLeaf
    | SectionLeaf
    | LessonLeaf
    | VideoLeaf
    | SegmentsLeaf
    | TimelineLeaf;
};

export type VfsDirNode = {
  kind: "dir";
  name: string;
  children: Map<string, VfsNode>;
  ghost?: boolean;
};

export type VfsNode = VfsLeafNode | VfsDirNode;

export type VfsLookupResult =
  | { type: "file"; node: VfsLeafNode }
  | { type: "dir"; node: VfsDirNode }
  | { type: "not-found"; path: string }
  | { type: "root"; node: VfsDirNode };

const mkDir = (name: string, ghost?: boolean): VfsDirNode => ({
  kind: "dir",
  name,
  children: new Map(),
  ...(ghost ? { ghost: true } : {}),
});

const mkFile = (name: string, data: VfsLeafNode["data"]): VfsLeafNode => ({
  kind: "file",
  name,
  data,
});

export type CourseEntry = {
  slug: string;
  courseLeaf: CourseLeaf;
  sections: SectionEntry[];
};

export type SectionEntry = {
  path: string;
  sectionLeaf: SectionLeaf;
  ghost: boolean;
  lessons: LessonEntry[];
};

export type LessonEntry = {
  path: string;
  lessonLeaf: LessonLeaf;
  ghost: boolean;
  videos: VideoEntry[];
};

export type VideoEntry = {
  path: string;
  videoLeaf: VideoLeaf;
  segmentsLeaf: SegmentsLeaf | null;
  timelineLeaf: TimelineLeaf | null;
};

export const buildVfsTree = (courses: CourseEntry[]): VfsDirNode => {
  const root = mkDir("");
  const coursesDir = mkDir("courses");
  root.children.set("courses", coursesDir);

  for (const course of courses) {
    const courseDir = mkDir(course.slug);
    coursesDir.children.set(course.slug, courseDir);

    courseDir.children.set(
      "course.json",
      mkFile("course.json", course.courseLeaf)
    );

    const sectionsDir = mkDir("sections");
    courseDir.children.set("sections", sectionsDir);

    for (const section of course.sections) {
      const sectionDir = mkDir(section.path, section.ghost);
      sectionsDir.children.set(section.path, sectionDir);

      sectionDir.children.set(
        "section.json",
        mkFile("section.json", section.sectionLeaf)
      );

      const lessonsDir = mkDir("lessons");
      sectionDir.children.set("lessons", lessonsDir);

      for (const lesson of section.lessons) {
        const lessonDir = mkDir(lesson.path, lesson.ghost);
        lessonsDir.children.set(lesson.path, lessonDir);

        lessonDir.children.set(
          "lesson.json",
          mkFile("lesson.json", lesson.lessonLeaf)
        );

        const videosDir = mkDir("videos");
        lessonDir.children.set("videos", videosDir);

        for (const video of lesson.videos) {
          const videoDir = mkDir(video.path);
          videosDir.children.set(video.path, videoDir);

          videoDir.children.set(
            "video.json",
            mkFile("video.json", video.videoLeaf)
          );

          if (video.segmentsLeaf) {
            videoDir.children.set(
              "segments.json",
              mkFile("segments.json", video.segmentsLeaf)
            );
          }

          if (video.timelineLeaf) {
            videoDir.children.set(
              "timeline.json",
              mkFile("timeline.json", video.timelineLeaf)
            );
          }
        }
      }
    }
  }

  return root;
};

export const lookupPath = (
  root: VfsDirNode,
  absolutePath: string
): VfsLookupResult => {
  if (absolutePath === "/") {
    return { type: "root", node: root };
  }

  const segments = absolutePath.split("/").filter(Boolean);
  let current: VfsNode = root;

  for (const seg of segments) {
    if (current.kind !== "dir") {
      return { type: "not-found", path: absolutePath };
    }
    const child = current.children.get(seg);
    if (!child) {
      return { type: "not-found", path: absolutePath };
    }
    current = child;
  }

  if (current.kind === "dir") {
    return { type: "dir", node: current };
  }
  return { type: "file", node: current };
};
