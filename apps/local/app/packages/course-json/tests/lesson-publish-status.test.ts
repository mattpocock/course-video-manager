import { describe, it, expect } from "vitest";
import {
  ANNOUNCE_NOTHING,
  ANNOUNCE_NOTHING_BAND,
  classifyLessonPublishStatus,
  lessonHardGaps,
  PLACEHOLDER_FLOOR_BANDS,
  placeholderFloorFromBand,
  type LessonPublishStatus,
  type PlaceholderFloor,
} from "../index";

const video = (
  overrides: Partial<{
    archived: boolean;
    body: string | null;
    clips: readonly unknown[];
  }> = {}
) => ({
  archived: false,
  body: "Video body",
  clips: [{ order: "a0" }],
  ...overrides,
});

const lesson = (
  overrides: Partial<{
    authoringStatus: string | null;
    priority: number;
    videos: readonly ReturnType<typeof video>[];
  }> = {}
) => ({
  authoringStatus: "todo" as string | null,
  priority: 2,
  videos: [video()],
  ...overrides,
});

/** The verdict as one readable word, so a table cell can be written by hand. */
const label = (verdict: LessonPublishStatus): string =>
  verdict.status === "withheld" ? `withheld:${verdict.reason}` : verdict.status;

// ── The seven gap cases ──────────────────────────────────────────────────
//
// `hardGap` is the fact each case exists to state: a gap Autofill can close
// never makes a Lesson a Placeholder Lesson.

const GAP_CASES = [
  { name: "a complete lesson", hardGap: false, videos: [video()] },
  { name: "a lesson with no video at all", hardGap: true, videos: [] },
  {
    name: "a lesson whose only video is archived",
    hardGap: true,
    videos: [video({ archived: true })],
  },
  {
    name: "a video with no clips",
    hardGap: true,
    videos: [video({ clips: [] })],
  },
  {
    name: "a video with no body",
    hardGap: true,
    videos: [video({ body: null })],
  },
  // A BLANK body is no body. The `missingBody` lint reads `""` that way, so if
  // the classifier did not, such a Video would ship, trip that lint, refuse the
  // release — and no floor position could rescue it.
  {
    name: "a video whose body is blank",
    hardGap: true,
    videos: [video({ body: "   " })],
  },
] as const;

// NOT IN THE TABLE, deliberately: a Video missing only its `description`, a
// Video missing only its Chapters, and an Unexported Video. Each is a real
// criterion — none of the three is a hard gap — but `ClassifiableVideo` cannot
// express any of them, so a row for one would pass the identical complete Video
// and assert the criterion by comment alone. They are proved where they are
// visible instead: the `description` and the Chapters in
// ./course-json-validation.test.ts (the builder ships and gap-checks such a
// Lesson), and exportedness in ../../../services/course-publish-readiness, whose
// unexported list never touches a Lesson Publish Status.

const PRIORITIES = [1, 2, 3, 9] as const;
const FLOORS: readonly PlaceholderFloor[] = [null, 1, 2, 3];

// The two positions of the to-do toggle, against the two authoring statuses it
// can act on. `withholding` is the fact each position states: does the toggle
// withhold this Lesson on its own?
const TOGGLE_POSITIONS = [
  {
    name: "a done lesson, todo included",
    authoringStatus: "done",
    includeTodoLessons: true,
    withholding: false,
  },
  {
    name: "a done lesson, todo excluded",
    authoringStatus: "done",
    includeTodoLessons: false,
    withholding: false,
  },
  {
    name: "a todo lesson, todo included",
    authoringStatus: "todo",
    includeTodoLessons: true,
    withholding: false,
  },
  {
    name: "a todo lesson, todo excluded",
    authoringStatus: "todo",
    includeTodoLessons: false,
    withholding: true,
  },
] as const;

// Rows are Priority 1, 2, 3 and 9 (out of range); columns are the floor's four
// positions: announce nothing, P1, P2, P3.
type FloorRow = readonly [string, string, string, string];

// A hard gap, on a Lesson the toggle is not withholding. The floor answers it.
const HARD_GAP: Record<(typeof PRIORITIES)[number], FloorRow> = {
  1: ["withheld:hard-gap", "placeholder", "placeholder", "placeholder"],
  2: ["withheld:hard-gap", "withheld:hard-gap", "placeholder", "placeholder"],
  3: [
    "withheld:hard-gap",
    "withheld:hard-gap",
    "withheld:hard-gap",
    "placeholder",
  ],
  9: [
    "withheld:hard-gap",
    "withheld:hard-gap",
    "withheld:hard-gap",
    "withheld:hard-gap",
  ],
};

// A hard gap on a Lesson the toggle IS withholding. The floor still wins inside
// the bands it names; outside them the toggle is named, because that is the
// control the author can flip.
const HARD_GAP_TOGGLED_OFF: Record<(typeof PRIORITIES)[number], FloorRow> = {
  1: ["withheld:todo", "placeholder", "placeholder", "placeholder"],
  2: ["withheld:todo", "withheld:todo", "placeholder", "placeholder"],
  3: ["withheld:todo", "withheld:todo", "withheld:todo", "placeholder"],
  9: ["withheld:todo", "withheld:todo", "withheld:todo", "withheld:todo"],
};

// No hard gap: the floor never reaches a Lesson that can ship in full, so only
// the toggle has anything to say — at every Priority and every floor position.
const SHIPS: FloorRow = ["ships", "ships", "ships", "ships"];
const TOGGLED_OFF: FloorRow = [
  "withheld:todo",
  "withheld:todo",
  "withheld:todo",
  "withheld:todo",
];

type Row = {
  gap: (typeof GAP_CASES)[number];
  toggle: (typeof TOGGLE_POSITIONS)[number];
  priority: (typeof PRIORITIES)[number];
  floor: PlaceholderFloor;
  expected: string;
};

const expectedRow = (
  gap: (typeof GAP_CASES)[number],
  toggle: (typeof TOGGLE_POSITIONS)[number],
  priority: (typeof PRIORITIES)[number]
): FloorRow => {
  if (gap.hardGap) {
    return toggle.withholding
      ? HARD_GAP_TOGGLED_OFF[priority]
      : HARD_GAP[priority];
  }
  return toggle.withholding ? TOGGLED_OFF : SHIPS;
};

const ROWS: Row[] = GAP_CASES.flatMap((gap) =>
  TOGGLE_POSITIONS.flatMap((toggle) =>
    PRIORITIES.flatMap((priority) =>
      FLOORS.map((floor, floorIndex): Row => ({
        gap,
        toggle,
        priority,
        floor,
        expected: expectedRow(gap, toggle, priority)[floorIndex]!,
      }))
    )
  )
);

describe("classifyLessonPublishStatus", () => {
  it.each(ROWS)(
    "$gap.name — $toggle.name — priority $priority, floor $floor → $expected",
    ({ gap, toggle, priority, floor, expected }) => {
      const verdict = classifyLessonPublishStatus(
        lesson({
          priority,
          videos: gap.videos,
          authoringStatus: toggle.authoringStatus,
        }),
        {
          includeTodoLessons: toggle.includeTodoLessons,
          placeholderFloor: floor,
        }
      );
      expect(label(verdict)).toBe(expected);
    }
  );

  it("names every hard gap it found on a lesson that does not ship", () => {
    const verdict = classifyLessonPublishStatus(
      lesson({ videos: [video({ clips: [], body: null })] }),
      { includeTodoLessons: true, placeholderFloor: 3 }
    );
    expect(verdict).toEqual({
      status: "placeholder",
      hardGaps: ["no-clips", "no-body"],
    });
  });

  it("is all-or-nothing: one gapped video decides the whole lesson", () => {
    const verdict = classifyLessonPublishStatus(
      lesson({ videos: [video(), video({ body: null })] }),
      { includeTodoLessons: true, placeholderFloor: ANNOUNCE_NOTHING }
    );
    expect(label(verdict)).toBe("withheld:hard-gap");
  });

  it("ignores archived videos when looking for gaps", () => {
    const verdict = classifyLessonPublishStatus(
      lesson({
        authoringStatus: "done",
        videos: [video(), video({ archived: true, clips: [], body: null })],
      }),
      { includeTodoLessons: true, placeholderFloor: ANNOUNCE_NOTHING }
    );
    expect(label(verdict)).toBe("ships");
  });

  it("names the hard gaps on a lesson the to-do toggle withholds", () => {
    const verdict = classifyLessonPublishStatus(
      lesson({ videos: [video({ clips: [] })] }),
      { includeTodoLessons: false, placeholderFloor: ANNOUNCE_NOTHING }
    );
    expect(verdict).toEqual({
      status: "withheld",
      reason: "todo",
      hardGaps: ["no-clips"],
    });
  });
});

// The floor's four positions, as the spellings a flag, a stored preference and
// a JSON body carry. `cvm course publish`, `cvm course readiness` and the
// publish page all read this one mapping, so "p2" means one thing everywhere;
// that the CLI refuses any other spelling is pinned at the command, in
// ../../../cli/cli-course-publish-placeholders.test.ts.
describe("the floor as a band", () => {
  it.each([
    ["none", null], // announce nothing — no Lesson ships as a Placeholder Lesson
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
  ] as const)("reads the band %s as the floor %s", (band, floor) => {
    expect(placeholderFloorFromBand(band)).toBe(floor);
  });

  it("offers exactly the four bands, in floor order", () => {
    expect(PLACEHOLDER_FLOOR_BANDS).toEqual(["none", "p1", "p2", "p3"]);
  });

  it("defaults to announcing nothing, so omitting the band publishes as before", () => {
    expect(ANNOUNCE_NOTHING_BAND).toBe("none");
    expect(placeholderFloorFromBand(ANNOUNCE_NOTHING_BAND)).toBe(
      ANNOUNCE_NOTHING
    );
  });
});

describe("lessonHardGaps", () => {
  it("finds nothing on a complete lesson", () => {
    expect(lessonHardGaps(lesson())).toEqual([]);
  });

  it("reports the missing lesson before looking at any video", () => {
    expect(lessonHardGaps(lesson({ videos: [] }))).toEqual(["no-active-video"]);
  });
});
