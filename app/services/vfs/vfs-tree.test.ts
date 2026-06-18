import { describe, it, expect } from "vitest";
import {
  buildVfsTree,
  lookupPath,
  type CourseEntry,
  type VfsDirNode,
} from "./vfs-tree";

const makeCourseEntry = (
  overrides: Partial<CourseEntry> = {}
): CourseEntry => ({
  slug: "my-course",
  courseLeaf: {
    id: "c1",
    name: "My Course",
    memory: "",
    version: { id: "v1", name: "Draft", description: "" },
  },
  sections: [],
  ...overrides,
});

describe("buildVfsTree", () => {
  it("creates root with /courses directory", () => {
    const root = buildVfsTree([]);
    expect(root.kind).toBe("dir");
    expect(root.children.has("courses")).toBe(true);
    const coursesDir = root.children.get("courses")!;
    expect(coursesDir.kind).toBe("dir");
  });

  it("lists courses under /courses", () => {
    const root = buildVfsTree([
      makeCourseEntry({ slug: "course-a" }),
      makeCourseEntry({ slug: "course-b" }),
    ]);
    const coursesDir = root.children.get("courses") as VfsDirNode;
    expect(coursesDir.children.has("course-a")).toBe(true);
    expect(coursesDir.children.has("course-b")).toBe(true);
  });

  it("places course.json inside each course directory", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = lookupPath(root, "/courses/my-course/course.json");
    expect(result.type).toBe("file");
    if (result.type === "file") {
      expect(result.node.data).toEqual({
        id: "c1",
        name: "My Course",
        memory: "",
        version: { id: "v1", name: "Draft", description: "" },
      });
    }
  });

  it("creates sections directory under each course", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = lookupPath(root, "/courses/my-course/sections");
    expect(result.type).toBe("dir");
  });

  it("creates full hierarchy: course > sections > section > lessons > lesson > videos > video", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
              order: 1,
              real: true,
            },
            ghost: false,
            lessons: [
              {
                path: "01.01-hello",
                lessonLeaf: {
                  id: "l1",
                  title: "Hello",
                  slug: "hello",
                  description: "",
                  icon: null,
                  priority: 2,
                  dependencies: [],
                  authoringStatus: "todo",
                  fsStatus: "real",
                  order: 1,
                },
                ghost: false,
                videos: [
                  {
                    path: "take-1",
                    videoLeaf: {
                      id: "vid1",
                      name: "take-1",
                      originalFootagePath: "/raw.mp4",
                      warnings: [],
                    },
                    segmentsLeaf: [
                      {
                        id: "seg1",
                        kind: "definition",
                        title: "Intro",
                        description: "",
                        order: 0,
                      },
                    ],
                    timelineLeaf: [
                      {
                        type: "chapter",
                        id: "ch1",
                        name: "Opening",
                      },
                      {
                        type: "clip",
                        id: "cl1",
                        text: "Hello world",
                        sourceStartTime: 0,
                        sourceEndTime: 3,
                        videoFilename: "raw.mp4",
                        beatType: "none",
                        scene: null,
                        profile: null,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    expect(
      lookupPath(root, "/courses/my-course/sections/01-intro/section.json").type
    ).toBe("file");

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json"
      ).type
    ).toBe("file");

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/video.json"
      ).type
    ).toBe("file");

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments.json"
      ).type
    ).toBe("file");

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline.json"
      ).type
    ).toBe("file");
  });
});

describe("ghost handling", () => {
  it("marks ghost section directory with ghost flag", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-planned",
            sectionLeaf: {
              id: "s1",
              slug: "planned",
              description: "",
              order: 1,
              real: false,
            },
            ghost: true,
            lessons: [],
          },
        ],
      }),
    ]);
    const result = lookupPath(root, "/courses/my-course/sections/01-planned");
    expect(result.type).toBe("dir");
    if (result.type === "dir") {
      expect(result.node.ghost).toBe(true);
    }
  });

  it("ghost section still has section.json and lessons/ dir", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-planned",
            sectionLeaf: {
              id: "s1",
              slug: "planned",
              description: "",
              order: 1,
              real: false,
            },
            ghost: true,
            lessons: [],
          },
        ],
      }),
    ]);
    expect(
      lookupPath(root, "/courses/my-course/sections/01-planned/section.json")
        .type
    ).toBe("file");
    expect(
      lookupPath(root, "/courses/my-course/sections/01-planned/lessons").type
    ).toBe("dir");
  });

  it("ghost lesson has lesson.json and empty videos/", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
              order: 1,
              real: false,
            },
            ghost: true,
            lessons: [
              {
                path: "01.01-planned",
                lessonLeaf: {
                  id: "l1",
                  title: "Planned",
                  slug: "planned",
                  description: "",
                  icon: null,
                  priority: 2,
                  dependencies: [],
                  authoringStatus: null,
                  fsStatus: "ghost",
                  order: 1,
                },
                ghost: true,
                videos: [],
              },
            ],
          },
        ],
      }),
    ]);

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-planned/lesson.json"
      ).type
    ).toBe("file");

    const videosResult = lookupPath(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-planned/videos"
    );
    expect(videosResult.type).toBe("dir");
    if (videosResult.type === "dir") {
      expect(videosResult.node.children.size).toBe(0);
    }
  });

  it("marks ghost lesson directory with ghost flag", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
              order: 1,
              real: false,
            },
            ghost: false,
            lessons: [
              {
                path: "01.01-planned",
                lessonLeaf: {
                  id: "l1",
                  title: "Planned",
                  slug: "planned",
                  description: "",
                  icon: null,
                  priority: 2,
                  dependencies: [],
                  authoringStatus: null,
                  fsStatus: "ghost",
                  order: 1,
                },
                ghost: true,
                videos: [],
              },
            ],
          },
        ],
      }),
    ]);
    const result = lookupPath(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-planned"
    );
    expect(result.type).toBe("dir");
    if (result.type === "dir") {
      expect(result.node.ghost).toBe(true);
    }
  });
});

describe("video without timeline (ghost lesson's video)", () => {
  it("omits timeline.json when null", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
              order: 1,
              real: true,
            },
            ghost: false,
            lessons: [
              {
                path: "01.01-hello",
                lessonLeaf: {
                  id: "l1",
                  title: "Hello",
                  slug: "hello",
                  description: "",
                  icon: null,
                  priority: 2,
                  dependencies: [],
                  authoringStatus: "todo",
                  fsStatus: "real",
                  order: 1,
                },
                ghost: false,
                videos: [
                  {
                    path: "take-1",
                    videoLeaf: {
                      id: "vid1",
                      name: "take-1",
                      originalFootagePath: "/raw.mp4",
                      warnings: [],
                    },
                    segmentsLeaf: null,
                    timelineLeaf: null,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline.json"
      ).type
    ).toBe("not-found");

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/segments.json"
      ).type
    ).toBe("not-found");

    expect(
      lookupPath(
        root,
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/video.json"
      ).type
    ).toBe("file");
  });
});

describe("lookupPath", () => {
  it("returns root for /", () => {
    const root = buildVfsTree([]);
    const result = lookupPath(root, "/");
    expect(result.type).toBe("root");
  });

  it("returns not-found for missing path", () => {
    const root = buildVfsTree([]);
    const result = lookupPath(root, "/courses/nonexistent");
    expect(result.type).toBe("not-found");
    if (result.type === "not-found") {
      expect(result.path).toBe("/courses/nonexistent");
    }
  });

  it("returns dir for intermediate directories", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = lookupPath(root, "/courses");
    expect(result.type).toBe("dir");
  });

  it("returns file for leaf nodes", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = lookupPath(root, "/courses/my-course/course.json");
    expect(result.type).toBe("file");
  });

  it("returns not-found when traversing through a file", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = lookupPath(root, "/courses/my-course/course.json/something");
    expect(result.type).toBe("not-found");
  });
});
