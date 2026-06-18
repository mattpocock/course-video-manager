import { describe, it, expect } from "vitest";
import { vfsTree } from "./vfs-tree-tool";
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
                { type: "chapter" as const, id: "ch1", name: "Opening" },
                {
                  type: "clip" as const,
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

describe("vfsTree", () => {
  it("prints the root tree", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsTree(root, "/");
    expect(result).toContain("courses/");
  });

  it("prints a full course subtree with indentation", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsTree(root, "/courses/my-course");
    const lines = result.split("\n");
    expect(lines[0]).toBe("my-course/");
    expect(lines).toContain("├── course.json");
    expect(result).toContain("sections/");
    expect(result).toContain("01-intro/");
    expect(result).toContain("take-1/");
    expect(result).toContain("timeline.json");
  });

  it("tags ghost directories", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsTree(root, "/courses/my-course/sections");
    expect(result).toContain("02-planned/   [ghost]");
    expect(result).toContain("02.01-future/   [ghost]");
  });

  it("respects the depth parameter", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsTree(root, "/courses/my-course", 1);
    expect(result).toContain("course.json");
    expect(result).toContain("sections/");
    expect(result).not.toContain("01-intro/");
  });

  it("returns error for non-existent path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsTree(root, "/courses/nonexistent");
    expect(result).toBe(
      "tree: /courses/nonexistent: No such file or directory"
    );
  });

  it("returns error for file path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsTree(root, "/courses/my-course/course.json");
    expect(result).toBe(
      "tree: /courses/my-course/course.json: Not a directory"
    );
  });

  it("applies ~400-line guardrail", () => {
    const sections = Array.from({ length: 30 }, (_, i) => ({
      path: `section-${String(i).padStart(2, "0")}`,
      sectionLeaf: {
        id: `s${i}`,
        slug: `section-${i}`,
        description: "",
        order: i,
        real: true,
      },
      ghost: false,
      lessons: Array.from({ length: 15 }, (_, j) => ({
        path: `lesson-${String(j).padStart(2, "0")}`,
        lessonLeaf: {
          id: `l${i}-${j}`,
          title: `Lesson ${j}`,
          slug: `lesson-${j}`,
          description: "",
          icon: null,
          priority: 2,
          dependencies: [],
          authoringStatus: "todo" as const,
          fsStatus: "real" as const,
          order: j,
        },
        ghost: false,
        videos: [],
      })),
    }));

    const root = buildVfsTree([makeCourseEntry({ sections })]);
    const result = vfsTree(root, "/courses/my-course");
    const lines = result.split("\n");
    expect(lines.length).toBeLessThanOrEqual(410);
    expect(result).toContain("[output truncated");
  });

  it("sorts entries alphabetically", () => {
    const root = buildVfsTree([
      makeCourseEntry({
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
    const result = vfsTree(root, "/courses/my-course/sections");
    const lines = result.split("\n");
    const alphaIdx = lines.findIndex((l) => l.includes("01-alpha/"));
    const betaIdx = lines.findIndex((l) => l.includes("02-beta/"));
    expect(alphaIdx).toBeLessThan(betaIdx);
  });

  it("uses correct tree connectors (├── and └──)", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsTree(root, "/courses/my-course");
    expect(result).toContain("├──");
    expect(result).toContain("└──");
  });
});
