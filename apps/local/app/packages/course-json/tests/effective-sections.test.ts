import { describe, it, expect } from "vitest";
import { computeEffectiveSections } from "../index";

type TestVideo = {
  archived: boolean;
  body: string | null;
  clips: readonly unknown[];
};

const video = (archived = false): TestVideo => ({
  archived,
  body: "Video body",
  clips: [{ order: "a0" }],
});

const lesson = (
  authoringStatus: string | null,
  videos: ReturnType<typeof video>[] = [video()],
  priority = 2
) => ({ authoringStatus, priority, videos });

const section = (lessons: ReturnType<typeof lesson>[]) => ({ lessons });

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

  it("removes archived videos from lessons that still ship", () => {
    const sections = [section([lesson("done", [video(true), video(false)])])];
    const result = computeEffectiveSections(sections, true);
    expect(result[0]!.lessons[0]!.videos).toEqual([video(false)]);
  });

  it("excludes lessons with no active videos regardless of toggle", () => {
    const noActive = lesson("done", [video(true)]);
    for (const include of [true, false]) {
      const result = computeEffectiveSections([section([noActive])], include);
      expect(result).toEqual([]);
    }
  });

  // A hard gap on a Video does not elide the Lesson yet — it is still a
  // release-stopping failure raised by collectPublishBlockers, so the walk has
  // to hand the Lesson on for the blocker collector to find.
  it("keeps a lesson whose video has a hard gap", () => {
    const gapped = lesson("done", [{ ...video(), clips: [] }]);
    expect(computeEffectiveSections([section([gapped])], true)).toHaveLength(1);
    const noBody = lesson("done", [{ ...video(), body: null }]);
    expect(computeEffectiveSections([section([noBody])], true)).toHaveLength(1);
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
          { id: "l-1", ...lesson("done") },
          { id: "l-2", ...lesson("todo") },
        ],
      },
    ];
    const result = computeEffectiveSections(sections, false);
    expect(result[0]!.id).toBe("sec-1");
    expect(result[0]!.path).toBe("01-intro");
    expect(result[0]!.lessons).toEqual([{ id: "l-1", ...lesson("done") }]);
  });
});
