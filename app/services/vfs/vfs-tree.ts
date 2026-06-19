import type {
  ChapterLeaf,
  ClipLeaf,
  CourseLeaf,
  LessonLeaf,
  MembersLeaf,
  SectionLeaf,
  SegmentLeaf,
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
    | SegmentLeaf
    | ClipLeaf
    | ChapterLeaf
    | MembersLeaf;
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

const toSlug = (text: string): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
};

const pad = (n: number): string => String(n).padStart(2, "0");

const clipLabel = (text: string): string =>
  text.length > 80 ? text.slice(0, 77) + "..." : text;

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
  segments: SegmentLeaf[];
  timelineItems: Array<ClipLeaf | ChapterLeaf>;
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

    const sectionMembers = course.sections.map((s) => ({
      id: s.sectionLeaf.id,
      slug: s.sectionLeaf.slug,
    }));
    sectionsDir.children.set(
      "_members.json",
      mkFile("_members.json", sectionMembers as MembersLeaf)
    );

    for (const section of course.sections) {
      const sectionDir = mkDir(section.path, section.ghost);
      sectionsDir.children.set(section.path, sectionDir);

      sectionDir.children.set(
        "section.json",
        mkFile("section.json", section.sectionLeaf)
      );

      const lessonsDir = mkDir("lessons");
      sectionDir.children.set("lessons", lessonsDir);

      const lessonMembers = section.lessons.map((l) => ({
        id: l.lessonLeaf.id,
        slug: l.lessonLeaf.slug,
        title: l.lessonLeaf.title,
      }));
      lessonsDir.children.set(
        "_members.json",
        mkFile("_members.json", lessonMembers as MembersLeaf)
      );

      for (const lesson of section.lessons) {
        const lessonDir = mkDir(lesson.path, lesson.ghost);
        lessonsDir.children.set(lesson.path, lessonDir);

        lessonDir.children.set(
          "lesson.json",
          mkFile("lesson.json", lesson.lessonLeaf)
        );

        const videosDir = mkDir("videos");
        lessonDir.children.set("videos", videosDir);

        const videoMembers = lesson.videos.map((v) => ({
          id: v.videoLeaf.id,
          name: v.videoLeaf.name,
        }));
        videosDir.children.set(
          "_members.json",
          mkFile("_members.json", videoMembers as MembersLeaf)
        );

        for (const video of lesson.videos) {
          const videoDir = mkDir(video.path);
          videosDir.children.set(video.path, videoDir);

          videoDir.children.set(
            "video.json",
            mkFile("video.json", video.videoLeaf)
          );

          if (video.segments.length > 0) {
            const segmentsDir = mkDir("segments");
            videoDir.children.set("segments", segmentsDir);

            const segmentMembers = video.segments.map((s) => ({
              id: s.id,
              kind: s.kind,
              title: s.title,
            }));
            segmentsDir.children.set(
              "_members.json",
              mkFile("_members.json", segmentMembers as MembersLeaf)
            );

            for (let i = 0; i < video.segments.length; i++) {
              const seg = video.segments[i]!;
              const name = `${pad(i)}-${toSlug(seg.title)}.json`;
              segmentsDir.children.set(name, mkFile(name, seg));
            }
          }

          if (video.timelineItems.length > 0) {
            const timelineDir = mkDir("timeline");
            videoDir.children.set("timeline", timelineDir);

            const timelineMembers = video.timelineItems.map((item) => ({
              id: item.id,
              type: item.type,
              label:
                item.type === "chapter"
                  ? item.name
                  : clipLabel((item as ClipLeaf).text),
            }));
            timelineDir.children.set(
              "_members.json",
              mkFile("_members.json", timelineMembers as MembersLeaf)
            );

            for (let i = 0; i < video.timelineItems.length; i++) {
              const item = video.timelineItems[i]!;
              const name =
                item.type === "clip"
                  ? `${pad(i)}.clip.json`
                  : `${pad(i)}-${toSlug(item.name)}.chapter.json`;
              timelineDir.children.set(name, mkFile(name, item));
            }
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
