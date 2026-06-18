import { describe, it, expect } from "vitest";
import { vfsCat, applyFilter } from "./vfs-cat";
import { buildVfsTree, type CourseEntry } from "./vfs-tree";
import type { TimelineLeaf, SegmentsLeaf } from "./vfs-schemas";

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
                  description: "Opening definition",
                  order: 0,
                },
                {
                  id: "seg2",
                  kind: "walkthrough",
                  title: "Main",
                  description: "Main walkthrough",
                  order: 1,
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
                {
                  type: "clip" as const,
                  id: "cl2",
                  text: "Second clip",
                  sourceStartTime: 3,
                  sourceEndTime: 6,
                  videoFilename: "raw.mp4",
                  beatType: "none",
                  scene: null,
                  profile: null,
                },
                { type: "chapter" as const, id: "ch2", name: "Closing" },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("vfsCat", () => {
  it("returns pretty-printed JSON for a leaf file", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsCat(root, "/courses/my-course/course.json");
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("c1");
    expect(parsed.name).toBe("My Course");
    expect(result).toContain("  ");
  });

  it("returns bash-style error for non-existent path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsCat(root, "/courses/nonexistent/course.json");
    expect(result).toBe(
      "cat: /courses/nonexistent/course.json: No such file or directory"
    );
  });

  it("returns bash-style error for directory path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsCat(root, "/courses/my-course");
    expect(result).toBe("cat: /courses/my-course: Is a directory");
  });

  it("returns bash-style error for root path", () => {
    const root = buildVfsTree([makeCourseEntry()]);
    const result = vfsCat(root, "/");
    expect(result).toBe("cat: /: Is a directory");
  });

  it("applies a filter when provided", () => {
    const root = buildVfsTree([fullCourse]);
    const result = vfsCat(
      root,
      "/courses/my-course/sections/01-intro/lessons/01.01-hello/videos/take-1/timeline.json",
      ".[0]"
    );
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("chapter");
    expect(parsed.name).toBe("Opening");
  });
});

describe("applyFilter", () => {
  const timeline: TimelineLeaf = [
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
    {
      type: "clip",
      id: "cl2",
      text: "Second clip",
      sourceStartTime: 3,
      sourceEndTime: 6,
      videoFilename: "raw.mp4",
      beatType: "none",
      scene: null,
      profile: null,
    },
    { type: "chapter", id: "ch2", name: "Closing" },
  ];

  const segments: SegmentsLeaf = [
    {
      id: "seg1",
      kind: "definition",
      title: "Intro",
      description: "Opening definition",
      order: 0,
    },
    {
      id: "seg2",
      kind: "walkthrough",
      title: "Main",
      description: "Main walkthrough",
      order: 1,
    },
  ];

  const courseLeaf = {
    id: "c1",
    name: "My Course",
    memory: "",
    version: { id: "v1", name: "Draft", description: "" },
  };

  describe(".[i] filter", () => {
    it("returns item at array index", () => {
      const result = applyFilter(timeline, ".[0]");
      expect(result).toEqual({ type: "chapter", id: "ch1", name: "Opening" });
    });

    it("returns item at a later index", () => {
      const result = applyFilter(timeline, ".[1]");
      expect(result).toHaveProperty("type", "clip");
      expect(result).toHaveProperty("text", "Hello world");
    });

    it("returns error for out-of-range index", () => {
      const result = applyFilter(timeline, ".[99]");
      expect(result).toBe("cat: .[99]: index out of range");
    });

    it("returns error for negative index", () => {
      const result = applyFilter(timeline, ".[-1]");
      expect(result).toBe("cat: .[-1]: index out of range");
    });

    it("returns error when applied to object file", () => {
      const result = applyFilter(courseLeaf, ".[0]");
      expect(result).toBe("cat: .[0]: not an array file");
    });
  });

  describe(".[i:j] slice filter", () => {
    it("returns slice of array", () => {
      const result = applyFilter(timeline, ".[0:2]");
      expect(result).toHaveLength(2);
      expect((result as any[])[0]).toHaveProperty("name", "Opening");
    });

    it("returns slice to end when j is omitted-like", () => {
      const result = applyFilter(timeline, ".[2:4]");
      expect(result).toHaveLength(2);
    });

    it("returns empty array for out-of-range slice", () => {
      const result = applyFilter(timeline, ".[10:20]");
      expect(result).toEqual([]);
    });

    it("returns error when applied to object file", () => {
      const result = applyFilter(courseLeaf, ".[0:2]");
      expect(result).toBe("cat: .[0:2]: not an array file");
    });
  });

  describe("names filter", () => {
    it("returns chapter names from timeline", () => {
      const result = applyFilter(timeline, "names");
      expect(result).toEqual(["Opening", "Closing"]);
    });

    it("returns error for non-timeline array", () => {
      const result = applyFilter(segments, "names");
      expect(result).toBe("cat: names: only applies to timeline.json");
    });

    it("returns error for object file", () => {
      const result = applyFilter(courseLeaf, "names");
      expect(result).toBe("cat: names: only applies to timeline.json");
    });
  });

  describe("text filter", () => {
    it("returns clip texts from timeline", () => {
      const result = applyFilter(timeline, "text");
      expect(result).toEqual(["Hello world", "Second clip"]);
    });

    it("returns error for non-timeline array", () => {
      const result = applyFilter(segments, "text");
      expect(result).toBe("cat: text: only applies to timeline.json");
    });

    it("returns error for object file", () => {
      const result = applyFilter(courseLeaf, "text");
      expect(result).toBe("cat: text: only applies to timeline.json");
    });
  });

  describe("count filter", () => {
    it("returns count for segments array", () => {
      const result = applyFilter(segments, "count");
      expect(result).toEqual({ items: 2 });
    });

    it("returns chapters/clips sub-counts for timeline", () => {
      const result = applyFilter(timeline, "count");
      expect(result).toEqual({ chapters: 2, clips: 2 });
    });

    it("returns error for object file", () => {
      const result = applyFilter(courseLeaf, "count");
      expect(result).toBe("cat: count: not an array file");
    });
  });

  describe(".field filter", () => {
    it("returns a single top-level field from object file", () => {
      const result = applyFilter(courseLeaf, ".name");
      expect(result).toBe("My Course");
    });

    it("returns nested object field", () => {
      const result = applyFilter(courseLeaf, ".version");
      expect(result).toEqual({ id: "v1", name: "Draft", description: "" });
    });

    it("returns error for non-existent field", () => {
      const result = applyFilter(courseLeaf, ".nonexistent");
      expect(result).toBe("cat: .nonexistent: no such field");
    });

    it("returns error when applied to array file", () => {
      const result = applyFilter(timeline, ".name");
      expect(result).toBe("cat: .name: not an object file");
    });
  });

  describe("unknown filter", () => {
    it("returns error for unknown filter", () => {
      const result = applyFilter(courseLeaf, "foo");
      expect(result).toBe("cat: bad filter: 'foo'");
    });

    it("returns error for filter-like but invalid syntax", () => {
      const result = applyFilter(timeline, ".[abc]");
      expect(result).toBe("cat: bad filter: '.[abc]'");
    });
  });
});
