import { describe, it, expect } from "vitest";
import {
  ANNOUNCE_NOTHING,
  computeEffectiveSections,
  computeShippingSections,
} from "../index";

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

/** The floor's default position, spelled out at every call site that uses it. */
const NONE = ANNOUNCE_NOTHING;

describe("computeEffectiveSections", () => {
  it("passes every lesson through when todo lessons are included", () => {
    const sections = [section([lesson("todo"), lesson("done"), lesson(null)])];
    const result = computeEffectiveSections(sections, true, NONE);
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(3);
  });

  it("withholds todo lessons and keeps done/null lessons when excluded", () => {
    const sections = [section([lesson("todo"), lesson("done"), lesson(null)])];
    const result = computeEffectiveSections(sections, false, NONE);
    expect(result[0]!.lessons.map((l) => l.authoringStatus)).toEqual([
      "done",
      null,
    ]);
  });

  it("removes archived videos from lessons that still ship", () => {
    const sections = [section([lesson("done", [video(true), video(false)])])];
    const result = computeEffectiveSections(sections, true, NONE);
    expect(result[0]!.lessons[0]!.videos).toEqual([video(false)]);
  });

  it("excludes lessons with no active videos regardless of toggle", () => {
    const noActive = lesson("done", [video(true)]);
    for (const include of [true, false]) {
      const result = computeEffectiveSections(
        [section([noActive])],
        include,
        NONE
      );
      expect(result).toEqual([]);
    }
  });

  // The floor is the whole difference between a withheld Lesson and an
  // announced one, so it has to reach this walk rather than being fixed inside
  // it (ADR 0029).
  it("withholds a lesson with a hard gap when the floor announces nothing", () => {
    const gapped = lesson("done", [{ ...video(), clips: [] }]);
    expect(computeEffectiveSections([section([gapped])], true, NONE)).toEqual(
      []
    );
    const noBody = lesson("done", [{ ...video(), body: null }]);
    expect(computeEffectiveSections([section([noBody])], true, NONE)).toEqual(
      []
    );
  });

  it("keeps a lesson with a hard gap once the floor reaches its priority", () => {
    const gapped = lesson("done", [{ ...video(), clips: [] }], 2);
    expect(computeEffectiveSections([section([gapped])], true, 1)).toEqual([]);
    expect(computeEffectiveSections([section([gapped])], true, 2)).toHaveLength(
      1
    );
    expect(computeEffectiveSections([section([gapped])], true, 3)).toHaveLength(
      1
    );
  });

  it("keeps a section whose every lesson is announced by the floor", () => {
    const sections = [
      section([
        lesson("done", [{ ...video(), body: null }], 1),
        lesson("done", [{ ...video(), clips: [] }], 1),
      ]),
    ];
    const result = computeEffectiveSections(sections, true, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.lessons).toHaveLength(2);
  });

  it("drops a section whose only lessons are withheld", () => {
    const sections = [section([lesson("todo"), lesson("todo")])];
    expect(computeEffectiveSections(sections, false, NONE)).toEqual([]);
  });

  it("drops a section whose only lessons have no active videos", () => {
    const sections = [section([lesson("done", [video(true)])])];
    expect(computeEffectiveSections(sections, true, NONE)).toEqual([]);
  });

  it("keeps a section that retains at least one effective lesson", () => {
    const sections = [section([lesson("todo"), lesson("done")])];
    const result = computeEffectiveSections(sections, false, NONE);
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
    const result = computeEffectiveSections(sections, false, NONE);
    expect(result[0]!.id).toBe("sec-1");
    expect(result[0]!.path).toBe("01-intro");
    expect(result[0]!.lessons).toEqual([{ id: "l-1", ...lesson("done") }]);
  });
});

// The asset set. It takes no floor: the floor only ever moves a Lesson between
// withheld and placeholder, and neither ships bytes.
describe("computeShippingSections", () => {
  it("keeps only the lessons that ship in full", () => {
    const sections = [
      section([
        lesson("done"),
        lesson("done", [{ ...video(), clips: [] }]),
        lesson("done", [{ ...video(), body: null }]),
        lesson("todo"),
      ]),
    ];
    expect(computeShippingSections(sections, false)[0]!.lessons).toHaveLength(
      1
    );
  });

  it("is unmoved by the floor that announces a gapped lesson", () => {
    const sections = [
      section([lesson("done"), lesson("done", [{ ...video(), clips: [] }], 1)]),
    ];
    // The floor turns the gapped lesson into a Placeholder Lesson, which ships
    // no .mp4 — so this walk returns the same one lesson either way.
    expect(computeShippingSections(sections, true)[0]!.lessons).toHaveLength(1);
    expect(
      computeEffectiveSections(sections, true, 1)[0]!.lessons
    ).toHaveLength(2);
  });

  it("drops a section with nothing shippable in it", () => {
    const sections = [section([lesson("done", [{ ...video(), body: null }])])];
    expect(computeShippingSections(sections, true)).toEqual([]);
  });
});
