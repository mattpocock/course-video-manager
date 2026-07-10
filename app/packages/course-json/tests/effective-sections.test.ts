import { describe, it, expect } from "vitest";
import {
  computeEffectiveSections,
  isLessonEffective,
  isLessonWithheld,
} from "../index";

const video = (archived = false) => ({ archived });

const lesson = (
  authoringStatus: string | null,
  videos: Array<{ archived: boolean }> = [video()]
) => ({ authoringStatus, videos });

const section = (lessons: ReturnType<typeof lesson>[]) => ({ lessons });

describe("isLessonWithheld", () => {
  it("withholds only a todo lesson when todo lessons are excluded", () => {
    expect(isLessonWithheld("todo", false)).toBe(true);
    expect(isLessonWithheld("done", false)).toBe(false);
    expect(isLessonWithheld(null, false)).toBe(false);
  });

  it("never withholds when todo lessons are included", () => {
    expect(isLessonWithheld("todo", true)).toBe(false);
    expect(isLessonWithheld("done", true)).toBe(false);
    expect(isLessonWithheld(null, true)).toBe(false);
  });
});

describe("isLessonEffective", () => {
  it("requires at least one active (non-archived) video", () => {
    expect(isLessonEffective(lesson("done", [video()]), true)).toBe(true);
    expect(isLessonEffective(lesson("done", []), true)).toBe(false);
    expect(isLessonEffective(lesson("done", [video(true)]), true)).toBe(false);
  });

  it("excludes withheld todo lessons even with active videos", () => {
    expect(isLessonEffective(lesson("todo", [video()]), false)).toBe(false);
    expect(isLessonEffective(lesson("todo", [video()]), true)).toBe(true);
  });
});

describe("computeEffectiveSections", () => {
  it("passes every lesson through when todo lessons are included", () => {
    const sections = [section([lesson("todo"), lesson("done"), lesson(null)])];
    const result = computeEffectiveSections(sections, true);
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(3);
  });

  it("withholds todo lessons and keeps done/null lessons when excluded", () => {
    const sections = [section([lesson("todo"), lesson("done"), lesson(null)])];
    const result = computeEffectiveSections(sections, false);
    expect(result[0]!.lessons.map((l) => l.authoringStatus)).toEqual([
      "done",
      null,
    ]);
  });

  it("excludes lessons with no active videos regardless of toggle", () => {
    const noActive = lesson("done", [video(true)]);
    for (const include of [true, false]) {
      const result = computeEffectiveSections([section([noActive])], include);
      expect(result).toEqual([]);
    }
  });

  it("drops a section whose only lessons are withheld", () => {
    const sections = [section([lesson("todo"), lesson("todo")])];
    expect(computeEffectiveSections(sections, false)).toEqual([]);
  });

  it("drops a section whose only lessons have no active videos", () => {
    const sections = [section([lesson("done", [video(true)])])];
    expect(computeEffectiveSections(sections, true)).toEqual([]);
  });

  it("keeps a section that retains at least one effective lesson", () => {
    const sections = [section([lesson("todo"), lesson("done")])];
    const result = computeEffectiveSections(sections, false);
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(1);
    expect(result[0]!.lessons[0]!.authoringStatus).toBe("done");
  });

  it("preserves non-filtered fields on sections and lessons", () => {
    const sections = [
      {
        id: "sec-1",
        path: "01-intro",
        lessons: [
          { id: "l-1", authoringStatus: "done", videos: [video()] },
          { id: "l-2", authoringStatus: "todo", videos: [video()] },
        ],
      },
    ];
    const result = computeEffectiveSections(sections, false);
    expect(result[0]!.id).toBe("sec-1");
    expect(result[0]!.path).toBe("01-intro");
    expect(result[0]!.lessons).toEqual([
      { id: "l-1", authoringStatus: "done", videos: [video()] },
    ]);
  });
});
