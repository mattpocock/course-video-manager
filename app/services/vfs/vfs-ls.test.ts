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
        title: "Intro",
        slug: "intro",
        description: "Intro section",
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
                { type: "chapter" as const, id: "ch1", name: "Opening" },
                {
                  type: "clip" as const,
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
    {
      path: "02-planned",
      sectionLeaf: {
        id: "s2",
        title: "Planned",
        slug: "planned",
        description: "",
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

  it("lists sections with _members.json first and ghost tags", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(root, "/courses/my-course/sections");
    const lines = result.split("\n");
    expect(lines[0]).toBe("_members.json");
    expect(lines).toContain("01-intro/");
    expect(lines).toContain("02-planned/   [ghost]");
  });

  it("lists lessons with _members.json first and ghost tags", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(
      root,
      "/courses/my-course/sections/02-planned/lessons"
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("_members.json");
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
    expect(lines).toContain("beats/");
    expect(lines).toContain("timeline/");
  });

  it("lists individual files inside beats/ directory", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/beats"
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("_members.json");
    expect(lines).toContain("00-intro.json");
  });

  it("lists individual files inside timeline/ directory", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsLs(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline"
    );
    const lines = result.split("\n");
    expect(lines[0]).toBe("_members.json");
    expect(lines).toContain("00-opening.chapter.json");
    expect(lines).toContain("01.clip.json");
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

  it("follows insertion order, not alphabetical", () => {
    const root = buildVfsTree([
      makeCourseEntry({
        slug: "my-course",
        sections: [
          {
            path: "02-beta",
            sectionLeaf: {
              id: "s2",
              title: "Beta",
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
              title: "Alpha",
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
    const result = vfsLs(root, "/courses/my-course/sections");
    const lines = result.split("\n");
    expect(lines[0]).toBe("_members.json");
    expect(lines[1]).toBe("02-beta/");
    expect(lines[2]).toBe("01-alpha/");
  });
});
