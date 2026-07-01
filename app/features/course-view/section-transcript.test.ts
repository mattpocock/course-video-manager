import { describe, it, expect } from "vitest";
import {
  buildSectionTranscript,
  buildCourseTranscript,
  filterSectionsForTranscript,
  type TranscriptOptions,
} from "./section-transcript";
import type { Lesson, Section } from "./course-view-types";

const makeLesson = (overrides: Partial<Lesson> = {}): Lesson =>
  ({
    id: "lesson-1",
    path: "01.01-intro",
    title: "Intro",
    description: "Lesson desc",
    priority: 1,
    icon: "watch",
    videos: [],
    ...overrides,
  }) as unknown as Lesson;

const makeSection = (overrides: Partial<Section> = {}): Section =>
  ({
    id: "section-1",
    path: "01-basics",
    description: "Section desc",
    lessons: [makeLesson()],
    ...overrides,
  }) as unknown as Section;

const baseOptions: TranscriptOptions = {
  includeTranscripts: false,
  includeLessonDescriptions: false,
  includeLessonTitles: false,
  includePriority: false,
  includeExerciseType: false,
  includeSectionDescription: false,
  includeSegments: false,
};

describe("buildSectionTranscript", () => {
  it("1. does not include section description by default", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions },
      {}
    );
    expect(result).not.toContain("<description>");
    expect(result).not.toContain("Section desc");
  });

  it("2. includes section description when includeSectionDescription is true", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      "Section desc"
    );
    expect(result).toContain("<description>Section desc</description>");
  });

  it("3. does not include section description when option is true but description is empty", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      ""
    );
    expect(result).not.toContain("<description>");
  });

  it("3b. does not include section description when option is true but description is undefined", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      undefined
    );
    expect(result).not.toContain("<description>");
  });

  it("4. escapes special characters in section description", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      'Desc with <tag> & "quotes"'
    );
    expect(result).toContain(
      "<description>Desc with &lt;tag&gt; &amp; &quot;quotes&quot;</description>"
    );
  });
});

describe("buildCourseTranscript", () => {
  it("5. includes section descriptions when includeSectionDescription is true", () => {
    const section = makeSection({ description: "My section desc" });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: true },
      {}
    );
    expect(result).toContain("<description>My section desc</description>");
  });

  it("6. does not include section descriptions when includeSectionDescription is false", () => {
    const section = makeSection({ description: "My section desc" });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: false },
      {}
    );
    expect(result).not.toContain("My section desc");
  });

  it("7. handles section with null description in course mode", () => {
    const section = makeSection({ description: null as unknown as string });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: true },
      {}
    );
    expect(result).not.toContain("<description>");
  });

  it("8. includes descriptions only for sections that have them", () => {
    const sectionWithDesc = makeSection({
      path: "01-with-desc",
      description: "Has description",
    });
    const sectionWithoutDesc = makeSection({
      path: "02-no-desc",
      description: null as unknown as string,
    });
    const result = buildCourseTranscript(
      "my-course",
      [sectionWithDesc, sectionWithoutDesc],
      { ...baseOptions, includeSectionDescription: true },
      {}
    );
    expect(result).toContain("<description>Has description</description>");
    // The second section should not have a description tag
    const descriptionCount = (result.match(/<description>/g) || []).length;
    expect(descriptionCount).toBe(1);
  });

  it("8b. produces valid output with empty sections array", () => {
    const result = buildCourseTranscript("my-course", [], baseOptions, {});
    expect(result).toBe('<course title="my-course">\n</course>');
  });
});

describe("filterSectionsForTranscript", () => {
  const noFilters = {
    priorityFilter: [] as number[],
    iconFilter: [] as string[],
    fsStatusFilter: null as string | null,
    searchQuery: "",
  };

  it("9. returns all sections/lessons when no filters active", () => {
    const sections = [
      makeSection({
        lessons: [
          makeLesson({ id: "l1", fsStatus: "real" as never }),
          makeLesson({ id: "l2", fsStatus: "ghost" as never }),
        ],
      }),
    ];
    const result = filterSectionsForTranscript(sections, noFilters);
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(2);
  });

  it("10. filters out ghost lessons when fsStatus filter is 'real'", () => {
    const sections = [
      makeSection({
        lessons: [
          makeLesson({ id: "l1", fsStatus: "real" as never }),
          makeLesson({ id: "l2", fsStatus: "ghost" as never }),
        ],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      fsStatusFilter: "real",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(1);
    expect((result[0]!.lessons[0] as unknown as { id: string }).id).toBe("l1");
  });

  it("11. filters out real lessons when fsStatus filter is 'ghost'", () => {
    const sections = [
      makeSection({
        lessons: [
          makeLesson({ id: "l1", fsStatus: "real" as never }),
          makeLesson({ id: "l2", fsStatus: "ghost" as never }),
        ],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      fsStatusFilter: "ghost",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(1);
    expect((result[0]!.lessons[0] as unknown as { id: string }).id).toBe("l2");
  });

  it("12. removes sections that have no lessons after filtering", () => {
    const sections = [
      makeSection({
        path: "01-all-ghost",
        lessons: [makeLesson({ id: "l1", fsStatus: "ghost" as never })],
      }),
      makeSection({
        path: "02-has-real",
        lessons: [makeLesson({ id: "l2", fsStatus: "real" as never })],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      fsStatusFilter: "real",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("02-has-real");
  });

  it("13. filters by priority", () => {
    const sections = [
      makeSection({
        lessons: [
          makeLesson({ id: "l1", priority: 1 }),
          makeLesson({ id: "l2", priority: 2 }),
          makeLesson({ id: "l3", priority: 3 }),
        ],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      priorityFilter: [1],
    });
    expect(result[0]!.lessons).toHaveLength(1);
    expect((result[0]!.lessons[0] as unknown as { id: string }).id).toBe("l1");
  });

  it("14. filters by icon type", () => {
    const sections = [
      makeSection({
        lessons: [
          makeLesson({ id: "l1", icon: "watch" }),
          makeLesson({ id: "l2", icon: "code" }),
        ],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      iconFilter: ["code"],
    });
    expect(result[0]!.lessons).toHaveLength(1);
    expect((result[0]!.lessons[0] as unknown as { id: string }).id).toBe("l2");
  });

  it("15. returns empty array when all sections become empty after filtering", () => {
    const sections = [
      makeSection({
        path: "01-all-ghost",
        lessons: [makeLesson({ id: "l1", fsStatus: "ghost" as never })],
      }),
      makeSection({
        path: "02-also-ghost",
        lessons: [makeLesson({ id: "l2", fsStatus: "ghost" as never })],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      fsStatusFilter: "real",
    });
    expect(result).toHaveLength(0);
  });

  it("16. combines multiple filters", () => {
    const sections = [
      makeSection({
        lessons: [
          makeLesson({ id: "l1", priority: 1, fsStatus: "real" as never }),
          makeLesson({ id: "l2", priority: 2, fsStatus: "real" as never }),
          makeLesson({ id: "l3", priority: 1, fsStatus: "ghost" as never }),
        ],
      }),
    ];
    const result = filterSectionsForTranscript(sections, {
      ...noFilters,
      priorityFilter: [1],
      fsStatusFilter: "real",
    });
    expect(result[0]!.lessons).toHaveLength(1);
    expect((result[0]!.lessons[0] as unknown as { id: string }).id).toBe("l1");
  });
});

describe("buildSectionTranscript - markdown format", () => {
  it("17. renders section as markdown with heading", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions },
      {},
      undefined,
      "markdown"
    );
    expect(result).toContain("# 01-basics");
    expect(result).not.toContain("<section");
  });

  it("18. includes section description as blockquote", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      "Section desc",
      "markdown"
    );
    expect(result).toContain("> Section desc");
  });

  it("19. renders lesson title and name in heading", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson({ path: "01.01-intro", title: "Intro" })],
      { ...baseOptions, includeLessonTitles: true },
      {},
      undefined,
      "markdown"
    );
    expect(result).toContain("## 01.01-intro");
    expect(result).toContain("Intro");
  });

  it("20. includes priority and exercise type in lesson heading", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson({ priority: 1, icon: "watch" })],
      { ...baseOptions, includePriority: true, includeExerciseType: true },
      {},
      undefined,
      "markdown"
    );
    expect(result).toContain("[P1]");
    expect(result).toContain("[watch]");
  });

  it("21. includes lesson description as blockquote", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson({ description: "Lesson desc" })],
      { ...baseOptions, includeLessonDescriptions: true },
      {},
      undefined,
      "markdown"
    );
    expect(result).toContain("> Lesson desc");
  });

  it("22. includes video transcripts", () => {
    const lesson = makeLesson({
      videos: [{ id: "v1", path: "video-001", clipCount: 3 } as never],
    });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeTranscripts: true },
      { v1: "[1] Hello [2] World" },
      undefined,
      "markdown"
    );
    expect(result).toContain("**video-001:**");
    expect(result).toContain("[1] Hello [2] World");
  });

  it("23. shows (no videos) for lesson without videos", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson({ videos: [] as never })],
      { ...baseOptions },
      {},
      undefined,
      "markdown"
    );
    expect(result).toContain("(no videos)");
  });
});

describe("buildCourseTranscript - markdown format", () => {
  it("24. renders course with top-level heading", () => {
    const section = makeSection({ description: "My desc" });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: true },
      {},
      "markdown"
    );
    expect(result.startsWith("# my-course")).toBe(true);
    expect(result).toContain("## 01-basics");
    expect(result).not.toContain("<course");
  });

  it("24b. empty course produces just heading", () => {
    const result = buildCourseTranscript(
      "my-course",
      [],
      baseOptions,
      {},
      "markdown"
    );
    expect(result).toBe("# my-course");
  });
});

describe("buildSectionTranscript - json format", () => {
  it("25. returns valid JSON with section title", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions },
      {},
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.section).toBe("01-basics");
    expect(parsed.lessons).toHaveLength(1);
  });

  it("26. includes section description when option enabled", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      "Section desc",
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.description).toBe("Section desc");
  });

  it("27. omits description field when option disabled", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: false },
      {},
      "Section desc",
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.description).toBeUndefined();
  });

  it("28. includes lesson metadata based on options", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [
        makeLesson({
          path: "01.01-intro",
          title: "Intro",
          priority: 1,
          icon: "watch",
        }),
      ],
      {
        ...baseOptions,
        includeLessonTitles: true,
        includePriority: true,
        includeExerciseType: true,
        includeLessonDescriptions: true,
      },
      {},
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    const lesson = parsed.lessons[0];
    expect(lesson.title).toBe("01.01-intro");
    expect(lesson.name).toBe("Intro");
    expect(lesson.priority).toBe("p1");
    expect(lesson.type).toBe("watch");
    expect(lesson.description).toBe("Lesson desc");
  });

  it("29. omits optional lesson fields when options disabled", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions },
      {},
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    const lesson = parsed.lessons[0];
    expect(lesson.name).toBeUndefined();
    expect(lesson.priority).toBeUndefined();
    expect(lesson.type).toBeUndefined();
    expect(lesson.description).toBeUndefined();
  });

  it("30. includes video transcripts when option enabled", () => {
    const lesson = makeLesson({
      videos: [{ id: "v1", path: "video-001", clipCount: 3 } as never],
    });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeTranscripts: true },
      { v1: "[1] Hello [2] World" },
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    const video = parsed.lessons[0].videos[0];
    expect(video.title).toBe("video-001");
    expect(video.transcript).toBe("[1] Hello [2] World");
  });
});

describe("buildCourseTranscript - json format", () => {
  it("31. returns valid JSON with course title and sections", () => {
    const section = makeSection();
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions },
      {},
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.course).toBe("my-course");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].section).toBe("01-basics");
  });

  it("31b. empty course in json", () => {
    const result = buildCourseTranscript(
      "my-course",
      [],
      baseOptions,
      {},
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.course).toBe("my-course");
    expect(parsed.sections).toHaveLength(0);
  });
});

describe("format defaults to xml", () => {
  it("32. buildSectionTranscript defaults to xml when no format given", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions },
      {}
    );
    expect(result).toContain("<section");
  });

  it("33. buildCourseTranscript defaults to xml when no format given", () => {
    const result = buildCourseTranscript(
      "my-course",
      [makeSection()],
      { ...baseOptions },
      {}
    );
    expect(result).toContain("<course");
  });
});
