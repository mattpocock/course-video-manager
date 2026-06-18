import { describe, it, expect } from "vitest";
import { vfsLs } from "./vfs-ls";
import { buildVfsTree, type CourseEntry } from "./vfs-tree";

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

const fullCourse = makeCourseEntry({
  sections: [
    {
      path: "01-intro",
      sectionLeaf: {
        id: "s1",
        slug: "intro",
        description: "Intro section",
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
                { type: "chapter", id: "ch1", name: "Opening" },
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
    {
      path: "02-planned",
      sectionLeaf: {
        id: "s2",
        slug: "planned",
        description: "",
        order: 2,
        real: false,
      },
      ghost: true,
      lessons: [
        {
          path: "02.01-future",
          lessonLeaf: {
            id: "l2",
            title: "Future",
            slug: "future",
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
});

describe("vfsLs", () => {
  it("lists root directory with trailing /", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsLs(root, "/");
    expect(result).toBe("courses/");
  });

  it("lists courses under /courses", () => {
    const root = buildVfsTree([
      makeCourseEntry({ slug: "alpha" }),
      makeCourseEntry({ slug: "beta" }),
    ]);
    const result = vfsLs(root, "/courses");
    const lines = result.split("\n");
    expect(lines).toContain("alpha/");
    expect(lines).toContain("beta/");
  });

  it("lists course contents", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsLs(root, "/courses/my-course");
    const lines = result.split("\n");
    expect(lines).toContain("course.json");
    expect(lines).toContain("sections/");
  });

  it("lists sections with ghost tags", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(root, "/courses/my-course/sections");
    const lines = result.split("\n");
    expect(lines).toContain("01-intro/");
    expect(lines).toContain("02-planned/   [ghost]");
  });

  it("lists lessons with ghost tags", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(
      root,
      "/courses/my-course/sections/02-planned/lessons"
    );
    const lines = result.split("\n");
    expect(lines).toContain("02.01-future/   [ghost]");
  });

  it("lists files inside a video directory", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1"
    );
    const lines = result.split("\n");
    expect(lines).toContain("video.json");
    expect(lines).toContain("segments.json");
    expect(lines).toContain("timeline.json");
  });

  it("returns bash-style error for non-existent path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsLs(root, "/courses/nonexistent");
    expect(result).toBe("ls: /courses/nonexistent: No such file or directory");
  });

  it("returns bash-style error for file path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsLs(root, "/courses/my-course/course.json");
    expect(result).toBe("ls: /courses/my-course/course.json: Not a directory");
  });

  it("does not tag files as ghost", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(root, "/courses/my-course/sections/02-planned");
    const lines = result.split("\n");
    expect(lines).toContain("section.json");
    expect(
      lines.find((l) => l.includes("section.json") && l.includes("[ghost]"))
    ).toBeUndefined();
  });

  it("sorts entries alphabetically", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        slug: "my-course",
        sections: [
          {
            path: "02-beta",
            sectionLeaf: {
              id: "s2",
              slug: "beta",
              description: "",
              order: 2,
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
              order: 1,
              real: true,
            },
            ghost: false,
            lessons: [],
          },
        ],
      }),
    ]);
    const result = vfsLs(root, "/courses/my-course/sections");
    const lines = result.split("\n");
    expect(lines[0]).toBe("01-alpha/");
    expect(lines[1]).toBe("02-beta/");
  });
});
