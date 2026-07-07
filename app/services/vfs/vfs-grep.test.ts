import { describe, it, expect } from "vitest";
import { vfsGrep } from "./vfs-grep";
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
        description: "Introduction to generics",
        real: true,
      },
      ghost: false,
      lessons: [
        {
          path: "01.01-hello",
          lessonLeaf: {
            id: "l1",
            title: "Hello Generics",
            slug: "hello",
            description: "Learn about generic types",
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
                  title: "Generics Intro",
                  description: "Opening definition of generics",
                },
                {
                  id: "seg2",
                  kind: "walkthrough",
                  title: "Main walkthrough",
                  description: "Walk through examples",
                },
              ],
              timelineItems: [
                { type: "chapter" as const, id: "ch1", name: "Opening" },
                {
                  type: "clip" as const,
                  id: "cl1",
                  text: "Today we learn about generics in TypeScript",
                  sourceStartTime: 0,
                  sourceEndTime: 3,
                  videoFilename: "raw.mp4",
                  pauseType: "none",
                  scene: null,
                  profile: null,
                },
                {
                  type: "clip" as const,
                  id: "cl2",
                  text: "Generics let you write reusable code",
                  sourceStartTime: 3,
                  sourceEndTime: 6,
                  videoFilename: "raw.mp4",
                  pauseType: "none",
                  scene: null,
                  profile: null,
                },
                {
                  type: "chapter" as const,
                  id: "ch2",
                  name: "Generics Deep Dive",
                },
              ],
            },
          ],
        },
        {
          path: "01.02-world",
          lessonLeaf: {
            id: "l2",
            title: "World",
            slug: "world",
            description: "Explore async/await patterns",
            icon: null,
            priority: 2,
            dependencies: [],
            authoringStatus: "done",
            fsStatus: "real",
          },
          ghost: false,
          videos: [],
        },
      ],
    },
  ],
});

const secondCourse = makeCourseEntry({
  slug: "other-course",
  courseLeaf: {
    id: "c2",
    name: "Other Course about Generics",
    memory: "",
    version: { id: "v2", name: "v1.0", description: "" },
  },
  sections: [
    {
      path: "01-advanced",
      sectionLeaf: {
        id: "s2",
        title: "Advanced",
        slug: "advanced",
        description: "Advanced topics",
        real: true,
      },
      ghost: false,
      lessons: [
        {
          path: "01.01-deep",
          lessonLeaf: {
            id: "l3",
            title: "Deep Generics",
            slug: "deep",
            description: "Deep dive into generics",
            icon: null,
            priority: 3,
            dependencies: [],
            authoringStatus: "done",
            fsStatus: "real",
          },
          ghost: false,
          videos: [],
        },
      ],
    },
  ],
});

const videoBase =
  "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1";

describe("vfsGrep", () => {
  describe("content mode", () => {
    it("matches course name", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "my course", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/course.json:name: My Course"
      );
    });

    it("matches section description", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/sections/01-intro/section.json:description: Introduction to generics"
      );
    });

    it("matches section path/slug", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "intro", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/sections/01-intro/section.json [path]: 01-intro"
      );
    });

    it("matches lesson title", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "hello", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json:title: Hello Generics"
      );
    });

    it("matches lesson slug/path", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "hello", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json [path]: 01.01-hello"
      );
    });

    it("matches lesson description", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "async/await", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/sections/01-intro/lessons/01.02-world/lesson.json:description: Explore async/await patterns"
      );
    });

    it("matches video path/slug only (not originalFootagePath)", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "take-1", "/courses/my-course");
      expect(result).toContain(`${videoBase}/video.json [path]: take-1`);
      const rawResult = vfsGrep(root, "raw\\.mp4", "/courses/my-course");
      expect(rawResult).not.toContain("video.json:originalFootagePath");
    });

    it("matches individual beat file title", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics intro", "/courses/my-course");
      expect(result).toContain(
        `${videoBase}/beats/00-generics-intro.json:title: Generics Intro`
      );
    });

    it("matches beat description when title does not match", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(
        root,
        "walk through examples",
        "/courses/my-course"
      );
      expect(result).toContain(
        `${videoBase}/beats/01-main-walkthrough.json:description: Walk through examples`
      );
    });

    it("matches beats _members.json with [i] locator", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics intro", "/courses/my-course");
      expect(result).toContain(
        `${videoBase}/beats/_members.json[0]: Generics Intro`
      );
    });

    it("matches individual clip file text", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "reusable code", "/courses/my-course");
      expect(result).toContain(
        `${videoBase}/timeline/02.clip.json:text: Generics let you write reusable code`
      );
    });

    it("matches individual chapter file name", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "deep dive", "/courses/my-course");
      expect(result).toContain(
        `${videoBase}/timeline/03-generics-deep-dive.chapter.json:name: Generics Deep Dive`
      );
    });

    it("matches timeline _members.json with [i] locator", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "deep dive", "/courses/my-course");
      expect(result).toContain(
        `${videoBase}/timeline/_members.json[3]: Generics Deep Dive`
      );
    });

    it("matches lesson _members.json title field", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "hello generics", "/courses/my-course");
      expect(result).toContain(
        "/courses/my-course/sections/01-intro/lessons/_members.json[0]: Hello Generics"
      );
    });

    it("is case-insensitive (Postgres ~* semantics)", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "GENERICS", "/courses/my-course");
      expect(result).toContain("Hello Generics");
    });

    it("supports regex patterns", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "gener.cs", "/courses/my-course");
      expect(result).toContain("Hello Generics");
    });

    it("reports title match only when title and description both match (beat file)", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics", "/courses/my-course");
      const segFileLines = result
        .split("\n")
        .filter((l) => l.includes("00-generics-intro.json"));
      expect(segFileLines).toHaveLength(1);
      expect(segFileLines[0]).toContain(":title:");
    });

    it("returns bash-style error for invalid regex", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "[invalid", "/courses/my-course");
      expect(result).toContain("grep: invalid regex");
    });

    it("returns empty output when nothing matches", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "zzzznotfound", "/courses/my-course");
      expect(result).toBe("");
    });
  });

  describe("files mode", () => {
    it("returns deduped file paths with at least one match", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics", "/courses/my-course", "files");
      const lines = result.split("\n").filter(Boolean);
      expect(lines).toContain(
        "/courses/my-course/sections/01-intro/section.json"
      );
      expect(lines).toContain(
        "/courses/my-course/sections/01-intro/lessons/01.01-hello/lesson.json"
      );
      expect(new Set(lines).size).toBe(lines.length);
    });

    it("includes individual beat and clip files when matched", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics", "/courses/my-course", "files");
      expect(result).toContain(`${videoBase}/beats/00-generics-intro.json`);
      expect(result).toContain(`${videoBase}/timeline/01.clip.json`);
      expect(result).toContain(
        `${videoBase}/timeline/03-generics-deep-dive.chapter.json`
      );
    });

    it("includes _members.json when members match", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics", "/courses/my-course", "files");
      expect(result).toContain(`${videoBase}/beats/_members.json`);
      expect(result).toContain(`${videoBase}/timeline/_members.json`);
    });
  });

  describe("path scoping", () => {
    it("defaults to current-course anchor (omitted path uses anchor prefix)", () => {
      const root = buildVfsTree([fullCourse, secondCourse]);
      const result = vfsGrep(root, "generics", "/courses/my-course");
      expect(result).not.toContain("/courses/other-course");
      expect(result).toContain("/courses/my-course");
    });

    it("scopes to / for catalogue-wide search", () => {
      const root = buildVfsTree([fullCourse, secondCourse]);
      const result = vfsGrep(root, "generics", "/");
      expect(result).toContain("/courses/my-course");
      expect(result).toContain("/courses/other-course");
    });

    it("scopes to a specific subtree within a course", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "generics", videoBase);
      expect(result).not.toContain("section.json");
      expect(result).not.toContain("lesson.json");
      expect(result).toContain("beats/");
      expect(result).toContain("timeline/");
    });

    it("returns error for non-existent scope path", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "anything", "/courses/nonexistent");
      expect(result).toBe(
        "grep: /courses/nonexistent: No such file or directory"
      );
    });
  });

  describe("field-set coverage", () => {
    it("does not search course memory", () => {
      const course = makeCourseEntry({
        courseLeaf: {
          id: "c1",
          name: "Test",
          memory: "secret memory content",
          version: { id: "v1", name: "Draft", description: "" },
        },
      });
      const root = buildVfsTree([course]);
      const result = vfsGrep(root, "secret memory", "/courses/my-course");
      expect(result).toBe("");
    });

    it("does not search clip videoFilename", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "raw\\.mp4", "/courses/my-course");
      expect(result).not.toContain(".clip.json");
      expect(result).not.toContain("video.json:originalFootagePath");
    });
  });

  describe("locator round-trip", () => {
    it("members [i] locator points to correct member", () => {
      const root = buildVfsTree([fullCourse]);
      const grepResult = vfsGrep(root, "reusable", "/courses/my-course");
      expect(grepResult).toContain(
        "timeline/_members.json[2]: Generics let you write reusable code"
      );
    });

    it("object field locator on lesson.json", () => {
      const root = buildVfsTree([fullCourse]);
      const result = vfsGrep(root, "hello generics", "/courses/my-course");
      expect(result).toContain("lesson.json:title: Hello Generics");
    });
  });
});
