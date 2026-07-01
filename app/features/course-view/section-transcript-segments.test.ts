import { describe, it, expect } from "vitest";
import {
  buildSectionTranscript,
  buildCourseTranscript,
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

const videoWithSegments = {
  id: "v1",
  path: "video-001",
  clipCount: 0,
  segments: [
    {
      id: "s1",
      kind: "definition",
      title: "What is TypeScript?",
      description: "Explain TS basics",
      order: "a0",
      videoId: "v1",
    },
    {
      id: "s2",
      kind: "walkthrough",
      title: "Setting up a project",
      description: "",
      order: "a1",
      videoId: "v1",
    },
  ],
} as never;

describe("includeSegments - xml format", () => {
  it("does not include segments by default", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions },
      {}
    );
    expect(result).not.toContain("<segment");
    expect(result).not.toContain("What is TypeScript?");
  });

  it("includes segments in xml when includeSegments is true", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {}
    );
    expect(result).toContain(
      '<segment kind="definition" title="What is TypeScript?">'
    );
    expect(result).toContain("<description>Explain TS basics</description>");
    expect(result).toContain(
      '<segment kind="walkthrough" title="Setting up a project"'
    );
  });

  it("omits description element when segment description is empty", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {}
    );
    expect(result).toContain(
      '<segment kind="walkthrough" title="Setting up a project" />'
    );
  });

  it("escapes special characters in segment title and description", () => {
    const lesson = makeLesson({
      videos: [
        {
          id: "v1",
          path: "video-001",
          clipCount: 0,
          segments: [
            {
              id: "s1",
              kind: "definition",
              title: 'Types & "Generics"',
              description: "<T> extends string",
              order: "a0",
              videoId: "v1",
            },
          ],
        } as never,
      ],
    });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {}
    );
    expect(result).toContain('title="Types &amp; &quot;Generics&quot;"');
    expect(result).toContain(
      "<description>&lt;T&gt; extends string</description>"
    );
  });

  it("includes segments in course transcript xml", () => {
    const section = makeSection({
      lessons: [makeLesson({ videos: [videoWithSegments] })],
    });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSegments: true },
      {}
    );
    expect(result).toContain(
      '<segment kind="definition" title="What is TypeScript?">'
    );
  });

  it("shows no segments when video has empty segments array", () => {
    const lesson = makeLesson({
      videos: [
        { id: "v1", path: "video-001", clipCount: 0, segments: [] } as never,
      ],
    });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {}
    );
    expect(result).not.toContain("<segment");
  });
});

describe("includeSegments - markdown format", () => {
  it("does not include segments in markdown by default", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions },
      {},
      undefined,
      "markdown"
    );
    expect(result).not.toContain("What is TypeScript?");
    expect(result).not.toContain("definition");
  });

  it("includes segments in markdown when enabled", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {},
      undefined,
      "markdown"
    );
    expect(result).toContain("What is TypeScript?");
    expect(result).toContain("definition");
    expect(result).toContain("Explain TS basics");
    expect(result).toContain("Setting up a project");
    expect(result).toContain("walkthrough");
  });

  it("omits description line when segment description is empty", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {},
      undefined,
      "markdown"
    );
    const lines = result.split("\n");
    const walkthroughLine = lines.findIndex((l) =>
      l.includes("Setting up a project")
    );
    const nextLine = lines[walkthroughLine + 1] ?? "";
    expect(nextLine).not.toContain("Explain");
  });
});

describe("includeSegments - json format", () => {
  it("does not include segments in json by default", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions },
      {},
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.lessons[0].videos[0].segments).toBeUndefined();
  });

  it("includes segments in json when enabled", () => {
    const lesson = makeLesson({ videos: [videoWithSegments] });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {},
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    const segments = parsed.lessons[0].videos[0].segments;
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      kind: "definition",
      title: "What is TypeScript?",
      description: "Explain TS basics",
    });
    expect(segments[1]).toEqual({
      kind: "walkthrough",
      title: "Setting up a project",
    });
  });

  it("includes segments in course json when enabled", () => {
    const section = makeSection({
      lessons: [makeLesson({ videos: [videoWithSegments] })],
    });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSegments: true },
      {},
      "json"
    );
    const parsed = JSON.parse(result);
    const segments = parsed.sections[0].lessons[0].videos[0].segments;
    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe("definition");
  });

  it("empty segments array produces empty array in json", () => {
    const lesson = makeLesson({
      videos: [
        { id: "v1", path: "video-001", clipCount: 0, segments: [] } as never,
      ],
    });
    const result = buildSectionTranscript(
      "01-basics",
      [lesson],
      { ...baseOptions, includeSegments: true },
      {},
      undefined,
      "json"
    );
    const parsed = JSON.parse(result);
    expect(parsed.lessons[0].videos[0].segments).toEqual([]);
  });
});
