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

  it("places _members.json at sections level", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
              real: true,
            },
            ghost: false,
            lessons: [],
          },
        ],
      }),
    ]);
    const result = lookupPath(
      root,
      "/courses/my-course/sections/_members.json"
    );
    expect(result.type).toBe("file");
    if (result.type === "file") {
      expect(result.node.data).toEqual([{ id: "s1", slug: "intro" }]);
    }
  });

  it("places _members.json at lessons level", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
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
                },
                ghost: false,
                videos: [],
              },
            ],
          },
        ],
      }),
    ]);
    const result = lookupPath(
      root,
      "/courses/my-course/sections/01-intro/lessons/_members.json"
    );
    expect(result.type).toBe("file");
    if (result.type === "file") {
      expect(result.node.data).toEqual([
        { id: "l1", slug: "hello", title: "Hello" },
      ]);
    }
  });

  it("places _members.json at videos level", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
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
                    beats: [],
                    timelineItems: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);
    const result = lookupPath(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/_members.json"
    );
    expect(result.type).toBe("file");
    if (result.type === "file") {
      expect(result.node.data).toEqual([{ id: "vid1", name: "take-1" }]);
    }
  });

  it("creates full hierarchy with beats/ and timeline/ directories", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
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
                    beats: [
                      {
                        id: "seg1",
                        kind: "definition",
                        title: "Intro",
                        description: "",
                      },
                    ],
                    timelineItems: [
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
                        pauseType: "none",
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

    const videoBase =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1";

    expect(lookupPath(root, `${videoBase}/video.json`).type).toBe("file");
    expect(lookupPath(root, `${videoBase}/beats`).type).toBe("dir");
    expect(lookupPath(root, `${videoBase}/beats/_members.json`).type).toBe(
      "file"
    );
    expect(lookupPath(root, `${videoBase}/beats/00-intro.json`).type).toBe(
      "file"
    );
    expect(lookupPath(root, `${videoBase}/timeline`).type).toBe("dir");
    expect(lookupPath(root, `${videoBase}/timeline/_members.json`).type).toBe(
      "file"
    );
    expect(
      lookupPath(root, `${videoBase}/timeline/00-opening.chapter.json`).type
    ).toBe("file");
    expect(lookupPath(root, `${videoBase}/timeline/01.clip.json`).type).toBe(
      "file"
    );
  });

  it("creates timeline _members.json with label (text snippet for clips, name for chapters)", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
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
                    beats: [],
                    timelineItems: [
                      { type: "chapter", id: "ch1", name: "Opening" },
                      {
                        type: "clip",
                        id: "cl1",
                        text: "Hello world",
                        sourceStartTime: 0,
                        sourceEndTime: 3,
                        videoFilename: "raw.mp4",
                        pauseType: "none",
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

    const result = lookupPath(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline/_members.json"
    );
    expect(result.type).toBe("file");
    if (result.type === "file") {
      expect(result.node.data).toEqual([
        { id: "ch1", type: "chapter", label: "Opening" },
        { id: "cl1", type: "clip", label: "Hello world" },
      ]);
    }
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
      // videos/ has _members.json (empty) only
      expect(videosResult.node.children.size).toBe(1);
      expect(videosResult.node.children.has("_members.json")).toBe(true);
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
  it("omits timeline/ and beats/ dirs when empty", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
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
                    beats: [],
                    timelineItems: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ]);

    const videoBase =
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1";

    expect(lookupPath(root, `${videoBase}/timeline`).type).toBe("not-found");
    expect(lookupPath(root, `${videoBase}/beats`).type).toBe("not-found");
    expect(lookupPath(root, `${videoBase}/video.json`).type).toBe("file");
  });
});

describe("insertion order", () => {
  it("children follow manifest insertion order, not alphabetical", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "02-beta",
            sectionLeaf: {
              id: "s2",
              slug: "beta",
              description: "",
              real: true,
            },
            ghost: false,
            lessons: [],
          },
          {
            path: "01-alpha",
            sectionLeaf: {
              id: "s1",
              slug: "alpha",
              description: "",
              real: true,
            },
            ghost: false,
            lessons: [],
          },
        ],
      }),
    ]);
    const sectionsDir = lookupPath(root, "/courses/my-course/sections");
    if (sectionsDir.type === "dir") {
      const keys = [...sectionsDir.node.children.keys()];
      expect(keys[0]).toBe("_members.json");
      expect(keys[1]).toBe("02-beta");
      expect(keys[2]).toBe("01-alpha");
    }
  });

  it("ghost sections appear inline at their manifest position", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        sections: [
          {
            path: "01-intro",
            sectionLeaf: {
              id: "s1",
              slug: "intro",
              description: "",
              real: true,
            },
            ghost: false,
            lessons: [],
          },
          {
            path: "planned",
            sectionLeaf: {
              id: "s2",
              slug: "planned",
              description: "",
              real: false,
            },
            ghost: true,
            lessons: [],
          },
          {
            path: "03-outro",
            sectionLeaf: {
              id: "s3",
              slug: "outro",
              description: "",
              real: true,
            },
            ghost: false,
            lessons: [],
          },
        ],
      }),
    ]);
    const sectionsDir = lookupPath(root, "/courses/my-course/sections");
    if (sectionsDir.type === "dir") {
      const keys = [...sectionsDir.node.children.keys()];
      expect(keys[0]).toBe("_members.json");
      expect(keys[1]).toBe("01-intro");
      expect(keys[2]).toBe("planned");
      expect(keys[3]).toBe("03-outro");
    }
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
