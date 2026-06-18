import { describe, it, expect } from "vitest";
import {
  generateCourseLeaf,
  generateSectionLeaf,
  generateLessonLeaf,
  generateVideoLeaf,
  generateSegmentsLeaf,
  generateTimelineLeaf,
} from "./vfs-leaves";
import {
  CourseLeafSchema,
  SectionLeafSchema,
  LessonLeafSchema,
  VideoLeafSchema,
  SegmentsLeafSchema,
  TimelineLeafSchema,
} from "./vfs-schemas";

describe("generateCourseLeaf", () => {
  it("validates against CourseLeafSchema", () => {
    const leaf = generateCourseLeaf(
      { id: "c1", name: "My Course", memory: "some notes" },
      { id: "v1", name: "v1.0", description: "First release" }
    );
    expect(CourseLeafSchema.parse(leaf)).toEqual(leaf);
  });

  it("includes all fields from course and version", () => {
    const leaf = generateCourseLeaf(
      { id: "c1", name: "My Course", memory: "notes" },
      { id: "v1", name: "Draft", description: "" }
    );
    expect(leaf).toEqual({
      id: "c1",
      name: "My Course",
      memory: "notes",
      version: { id: "v1", name: "Draft", description: "" },
    });
  });
});

describe("generateSectionLeaf", () => {
  it("validates against SectionLeafSchema", () => {
    const leaf = generateSectionLeaf({
      id: "s1",
      path: "01-intro",
      description: "Introduction",
      order: 1,
      lessons: [{ fsStatus: "real" }],
    });
    expect(SectionLeafSchema.parse(leaf)).toEqual(leaf);
  });

  it("extracts slug from numbered path", () => {
    const leaf = generateSectionLeaf({
      id: "s1",
      path: "02-advanced-topics",
      description: "",
      order: 2,
      lessons: [],
    });
    expect(leaf.slug).toBe("advanced-topics");
  });

  it("uses full path as slug when not numbered", () => {
    const leaf = generateSectionLeaf({
      id: "s1",
      path: "my-section",
      description: "",
      order: 1,
      lessons: [],
    });
    expect(leaf.slug).toBe("my-section");
  });

  it("marks section as real when it has real lessons", () => {
    const leaf = generateSectionLeaf({
      id: "s1",
      path: "01-intro",
      description: "",
      order: 1,
      lessons: [{ fsStatus: "ghost" }, { fsStatus: "real" }],
    });
    expect(leaf.real).toBe(true);
  });

  it("marks section as ghost when all lessons are ghosts", () => {
    const leaf = generateSectionLeaf({
      id: "s1",
      path: "01-intro",
      description: "",
      order: 1,
      lessons: [{ fsStatus: "ghost" }],
    });
    expect(leaf.real).toBe(false);
  });

  it("marks section as ghost when it has no lessons", () => {
    const leaf = generateSectionLeaf({
      id: "s1",
      path: "01-intro",
      description: "",
      order: 1,
      lessons: [],
    });
    expect(leaf.real).toBe(false);
  });
});

describe("generateLessonLeaf", () => {
  it("validates against LessonLeafSchema", () => {
    const leaf = generateLessonLeaf({
      id: "l1",
      path: "01.01-hello-world",
      title: "Hello World",
      description: "First lesson",
      icon: "book",
      priority: 2,
      dependencies: ["l0"],
      authoringStatus: "todo",
      fsStatus: "real",
      order: 1,
    });
    expect(LessonLeafSchema.parse(leaf)).toEqual(leaf);
  });

  it("extracts slug from lesson path", () => {
    const leaf = generateLessonLeaf({
      id: "l1",
      path: "02.05-advanced-generics",
      title: "Advanced Generics",
      description: "",
      icon: null,
      priority: 2,
      dependencies: null,
      authoringStatus: "done",
      fsStatus: "real",
      order: 5,
    });
    expect(leaf.slug).toBe("advanced-generics");
  });

  it("uses full path as slug for unparseable paths", () => {
    const leaf = generateLessonLeaf({
      id: "l1",
      path: "my-lesson",
      title: "",
      description: "",
      icon: null,
      priority: 2,
      dependencies: null,
      authoringStatus: null,
      fsStatus: "ghost",
      order: 1,
    });
    expect(leaf.slug).toBe("my-lesson");
  });

  it("defaults null dependencies to empty array", () => {
    const leaf = generateLessonLeaf({
      id: "l1",
      path: "01.01-test",
      title: "",
      description: "",
      icon: null,
      priority: 2,
      dependencies: null,
      authoringStatus: "todo",
      fsStatus: "real",
      order: 1,
    });
    expect(leaf.dependencies).toEqual([]);
  });

  it("ghost lesson has null authoringStatus", () => {
    const leaf = generateLessonLeaf({
      id: "l1",
      path: "01.01-test",
      title: "",
      description: "",
      icon: null,
      priority: 2,
      dependencies: null,
      authoringStatus: null,
      fsStatus: "ghost",
      order: 1,
    });
    expect(leaf.authoringStatus).toBeNull();
    expect(leaf.fsStatus).toBe("ghost");
  });
});

describe("generateVideoLeaf", () => {
  it("validates against VideoLeafSchema", () => {
    const leaf = generateVideoLeaf({
      id: "v1",
      path: "take-1.mp4",
      originalFootagePath: "/footage/take-1.mp4",
      clips: [{ order: "a0", archived: false }],
      chapters: [{ order: "a", archived: false }],
    });
    expect(VideoLeafSchema.parse(leaf)).toEqual(leaf);
  });

  it("uses path as name", () => {
    const leaf = generateVideoLeaf({
      id: "v1",
      path: "my-video",
      originalFootagePath: "/footage/raw.mp4",
      clips: [],
      chapters: [],
    });
    expect(leaf.name).toBe("my-video");
  });

  it("computes warnings from clips and chapters", () => {
    const leaf = generateVideoLeaf({
      id: "v1",
      path: "take-1",
      originalFootagePath: "/footage/take-1.mp4",
      clips: [{ order: "b", archived: false }],
      chapters: [],
    });
    expect(leaf.warnings).toEqual([{ kind: "missingOpeningChapter" }]);
  });

  it("returns no warnings when chapter opens before first clip", () => {
    const leaf = generateVideoLeaf({
      id: "v1",
      path: "take-1",
      originalFootagePath: "/footage/take-1.mp4",
      clips: [{ order: "b", archived: false }],
      chapters: [{ order: "a", archived: false }],
    });
    expect(leaf.warnings).toEqual([]);
  });
});

describe("generateSegmentsLeaf", () => {
  it("validates against SegmentsLeafSchema", () => {
    const leaf = generateSegmentsLeaf([
      {
        id: "seg1",
        kind: "definition",
        title: "Intro",
        description: "Set the stage",
        order: "b0",
      },
      {
        id: "seg2",
        kind: "walkthrough",
        title: "Demo",
        description: "Walk through code",
        order: "a0",
      },
    ]);
    expect(SegmentsLeafSchema.parse(leaf)).toEqual(leaf);
  });

  it("sorts segments by order and assigns positional index", () => {
    const leaf = generateSegmentsLeaf([
      {
        id: "seg1",
        kind: "definition",
        title: "Second",
        description: "",
        order: "b0",
      },
      {
        id: "seg2",
        kind: "walkthrough",
        title: "First",
        description: "",
        order: "a0",
      },
    ]);
    expect(leaf[0]!.title).toBe("First");
    expect(leaf[0]!.order).toBe(0);
    expect(leaf[1]!.title).toBe("Second");
    expect(leaf[1]!.order).toBe(1);
  });

  it("returns empty array for no segments", () => {
    expect(generateSegmentsLeaf([])).toEqual([]);
  });
});

describe("generateTimelineLeaf", () => {
  it("validates against TimelineLeafSchema", () => {
    const clips = [
      {
        id: "cl1",
        order: "b0",
        text: "Hello world",
        sourceStartTime: 0,
        sourceEndTime: 5.5,
        videoFilename: "raw.mp4",
        beatType: "none",
        scene: null,
        profile: null,
        archived: false,
      },
    ];
    const chapters = [
      { id: "ch1", order: "a0", name: "Opening", archived: false },
    ];
    const leaf = generateTimelineLeaf(clips, chapters);
    expect(TimelineLeafSchema.parse(leaf)).toEqual(leaf);
  });

  it("interleaves clips and chapters in order", () => {
    const clips = [
      {
        id: "cl1",
        order: "b0",
        text: "First clip",
        sourceStartTime: 0,
        sourceEndTime: 3,
        videoFilename: "raw.mp4",
        beatType: "none",
        scene: null,
        profile: null,
        archived: false,
      },
      {
        id: "cl2",
        order: "d0",
        text: "Second clip",
        sourceStartTime: 3,
        sourceEndTime: 6,
        videoFilename: "raw.mp4",
        beatType: "none",
        scene: "screencast",
        profile: "wide",
        archived: false,
      },
    ];
    const chapters = [
      { id: "ch1", order: "a0", name: "Intro", archived: false },
      { id: "ch2", order: "c0", name: "Demo", archived: false },
    ];
    const leaf = generateTimelineLeaf(clips, chapters);

    expect(leaf).toHaveLength(4);
    expect(leaf[0]).toEqual({ type: "chapter", id: "ch1", name: "Intro" });
    expect(leaf[1]).toEqual({
      type: "clip",
      id: "cl1",
      text: "First clip",
      sourceStartTime: 0,
      sourceEndTime: 3,
      videoFilename: "raw.mp4",
      beatType: "none",
      scene: null,
      profile: null,
    });
    expect(leaf[2]).toEqual({ type: "chapter", id: "ch2", name: "Demo" });
    expect(leaf[3]).toEqual({
      type: "clip",
      id: "cl2",
      text: "Second clip",
      sourceStartTime: 3,
      sourceEndTime: 6,
      videoFilename: "raw.mp4",
      beatType: "none",
      scene: "screencast",
      profile: "wide",
    });
  });

  it("retains id on every item", () => {
    const clips = [
      {
        id: "cl1",
        order: "a0",
        text: "clip",
        sourceStartTime: 0,
        sourceEndTime: 1,
        videoFilename: "raw.mp4",
        beatType: "none",
        scene: null,
        profile: null,
        archived: false,
      },
    ];
    const chapters = [
      { id: "ch1", order: "b0", name: "Chapter", archived: false },
    ];
    const leaf = generateTimelineLeaf(clips, chapters);
    expect(leaf[0]).toHaveProperty("id", "cl1");
    expect(leaf[1]).toHaveProperty("id", "ch1");
  });

  it("excludes archived clips", () => {
    const clips = [
      {
        id: "cl1",
        order: "a0",
        text: "live",
        sourceStartTime: 0,
        sourceEndTime: 1,
        videoFilename: "raw.mp4",
        beatType: "none",
        scene: null,
        profile: null,
        archived: false,
      },
      {
        id: "cl2",
        order: "b0",
        text: "dead",
        sourceStartTime: 1,
        sourceEndTime: 2,
        videoFilename: "raw.mp4",
        beatType: "none",
        scene: null,
        profile: null,
        archived: true,
      },
    ];
    const leaf = generateTimelineLeaf(clips, []);
    expect(leaf).toHaveLength(1);
    expect(leaf[0]).toHaveProperty("id", "cl1");
  });

  it("excludes archived chapters", () => {
    const chapters = [
      { id: "ch1", order: "a0", name: "Live", archived: false },
      { id: "ch2", order: "b0", name: "Dead", archived: true },
    ];
    const leaf = generateTimelineLeaf([], chapters);
    expect(leaf).toHaveLength(1);
    expect(leaf[0]).toEqual({ type: "chapter", id: "ch1", name: "Live" });
  });

  it("returns empty array when no clips or chapters", () => {
    expect(generateTimelineLeaf([], [])).toEqual([]);
  });
});
