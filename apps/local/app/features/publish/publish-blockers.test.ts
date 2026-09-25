import { describe, expect, it } from "vitest";
import {
  splitAutofillClearable,
  type PublishBlockerLists,
} from "./publish-blockers";
import type { AutofillCandidate } from "@/services/autofill-candidates";
import { collectLessonPublishStatuses } from "@/services/course-publish-lesson-statuses";
import {
  ANNOUNCE_NOTHING,
  type PlaceholderFloor,
} from "@/packages/course-json";
import {
  formatHardGaps,
  formatPublishSummary,
  placeholderFloorStorageKey,
  WITHHELD_REASON_LABELS,
} from "./placeholder-floor";

const SECTION = "01-intro";
const LESSON = "01.01-welcome";

const lists = (
  overrides: Partial<PublishBlockerLists> = {}
): PublishBlockerLists => ({
  courseViewLints: [],
  incompleteVideos: [],
  invalidLessonCombos: [],
  ...overrides,
});

const videoLint = (
  kind: "missingChapters" | "missingDescription" | "missingBody",
  videoTitle = "Explainer"
) => ({
  scope: "video" as const,
  sectionPath: SECTION,
  lessonPath: LESSON,
  videoTitle,
  kind,
});

/** A Video the Autofill will act on, named the way the run names it. */
const candidate = (
  fields: AutofillCandidate["fields"],
  videoTitle = "Explainer",
  lessonPath = LESSON
): AutofillCandidate => ({
  videoId: `${lessonPath}/${videoTitle}`,
  title: `${SECTION}/${lessonPath}/${videoTitle}`,
  fields,
});

describe("grouping the publish page's blockers", () => {
  it("folds away the two signals the Autofill will write", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        courseViewLints: [
          videoLint("missingChapters"),
          videoLint("missingDescription"),
        ],
      }),
      [candidate(["description", "chapters"])]
    );

    expect(clearable.courseViewLints).toHaveLength(2);
    expect(mine.courseViewLints).toHaveLength(0);
  });

  it("leaves the blockers only Matt can fix in plain sight", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        courseViewLints: [
          videoLint("missingBody"),
          {
            scope: "lesson",
            sectionPath: SECTION,
            lessonPath: LESSON,
            kind: "duplicateRoles",
          },
        ],
        invalidLessonCombos: [
          {
            sectionPath: SECTION,
            lessonPath: LESSON,
            videoTitles: ["Explainer", "Problem"],
          },
        ],
      }),
      []
    );

    expect(clearable.courseViewLints).toHaveLength(0);
    expect(clearable.invalidLessonCombos).toHaveLength(0);
    expect(mine.courseViewLints).toHaveLength(2);
    expect(mine.invalidLessonCombos).toHaveLength(1);
  });

  // The accordion is a promise that one press clears what is inside it, so it
  // must be read off the candidates themselves. A Video can raise both signals
  // and still be no candidate at all — and then the press does nothing for it.
  it("keeps a Video with no Body in plain sight, though it raises both signals", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        courseViewLints: [
          videoLint("missingBody"),
          videoLint("missingDescription"),
          videoLint("missingChapters"),
        ],
        incompleteVideos: [
          {
            sectionPath: SECTION,
            lessonPath: LESSON,
            videoTitle: "Explainer",
            missing: ["description"],
          },
        ],
      }),
      // No Body means no candidate at all — the run skips this Video entirely.
      []
    );

    expect(clearable.courseViewLints).toHaveLength(0);
    expect(clearable.incompleteVideos).toHaveLength(0);
    expect(mine.courseViewLints).toHaveLength(3);
    expect(mine.incompleteVideos).toHaveLength(1);
  });

  it("folds away only the field the run will write for a partly-ready Video", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        courseViewLints: [
          videoLint("missingDescription"),
          videoLint("missingChapters"),
        ],
      }),
      // Untranscribed Clips: the description is written, the Chapters are not.
      [candidate(["description"])]
    );

    expect(clearable.courseViewLints.map((l) => l.kind)).toEqual([
      "missingDescription",
    ]);
    expect(mine.courseViewLints.map((l) => l.kind)).toEqual([
      "missingChapters",
    ]);
  });

  it("only folds away an incomplete Video whose one gap the run will fill", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        incompleteVideos: [
          {
            sectionPath: SECTION,
            lessonPath: LESSON,
            videoTitle: "One press away",
            missing: ["description"],
          },
          {
            sectionPath: SECTION,
            lessonPath: "01.02-next",
            videoTitle: "Needs a body too",
            missing: ["body", "description"],
          },
          {
            sectionPath: SECTION,
            lessonPath: "01.03-later",
            videoTitle: "Not even filmed",
            missing: ["clips"],
          },
        ],
      }),
      [candidate(["description"], "One press away")]
    );

    expect(clearable.incompleteVideos.map((v) => v.videoTitle)).toEqual([
      "One press away",
    ]);
    expect(mine.incompleteVideos.map((v) => v.videoTitle)).toEqual([
      "Needs a body too",
      "Not even filmed",
    ]);
  });

  it("does not let one Video's candidacy fold away another's blocker", () => {
    const titles = (lints: PublishBlockerLists["courseViewLints"]) =>
      lints.map((lint) => (lint.scope === "video" ? lint.videoTitle : "—"));

    const { clearable, mine } = splitAutofillClearable(
      lists({
        courseViewLints: [
          videoLint("missingDescription", "Explainer"),
          videoLint("missingDescription", "Problem"),
        ],
      }),
      [candidate(["description"], "Explainer")]
    );

    expect(titles(clearable.courseViewLints)).toEqual(["Explainer"]);
    expect(titles(mine.courseViewLints)).toEqual(["Problem"]);
  });

  it("loses no blocker: every one is still listed somewhere", () => {
    const all = lists({
      courseViewLints: [videoLint("missingChapters"), videoLint("missingBody")],
      incompleteVideos: [
        {
          sectionPath: SECTION,
          lessonPath: LESSON,
          videoTitle: "Explainer",
          missing: ["description"],
        },
      ],
      invalidLessonCombos: [
        {
          sectionPath: SECTION,
          lessonPath: "01.02-next",
          videoTitles: ["Explainer", "Problem"],
        },
      ],
    });
    const { clearable, mine } = splitAutofillClearable(all, [
      candidate(["description", "chapters"]),
    ]);

    const count = (l: PublishBlockerLists) =>
      l.courseViewLints.length +
      l.incompleteVideos.length +
      l.invalidLessonCombos.length;

    expect(count(clearable) + count(mine)).toBe(count(all));
  });
});

// THE PLACEHOLDER FLOOR, as the publish page reads it: the three Lesson Publish
// Status counts on the summary line, and which Lesson lands on which of the two
// cards. Every assertion here goes through `collectLessonPublishStatuses` — the
// same walk that builds the manifest — because the page and the release must
// never be able to disagree.

const video = (
  overrides: { body?: string | null; clips?: number; archived?: boolean } = {}
) => ({
  archived: overrides.archived ?? false,
  body: overrides.body === undefined ? "the body" : overrides.body,
  clips: Array.from({ length: overrides.clips ?? 1 }, (_, i) => i),
});

const lesson = (
  path: string,
  overrides: {
    priority?: number;
    authoringStatus?: string | null;
    videos?: ReturnType<typeof video>[];
  } = {}
) => ({
  path,
  title: path.toUpperCase(),
  priority: overrides.priority ?? 2,
  authoringStatus:
    overrides.authoringStatus === undefined
      ? "done"
      : overrides.authoringStatus,
  videos: overrides.videos ?? [video()],
});

const tree = (lessons: ReturnType<typeof lesson>[]) => [
  { path: SECTION, lessons },
];

const statuses = (
  lessons: ReturnType<typeof lesson>[],
  options: {
    includeTodoLessons?: boolean;
    placeholderFloor?: PlaceholderFloor;
  } = {}
) =>
  collectLessonPublishStatuses(tree(lessons), {
    includeTodoLessons: options.includeTodoLessons ?? true,
    placeholderFloor: options.placeholderFloor ?? ANNOUNCE_NOTHING,
  });

const paths = (rows: ReadonlyArray<{ lessonPath: string }>) =>
  rows.map((row) => row.lessonPath);

describe("the publish page's summary line", () => {
  it("puts every lesson in exactly one of the three counts", () => {
    const result = statuses(
      [
        lesson("ships"),
        lesson("no-video", { priority: 1, videos: [] }),
        lesson("no-body", { priority: 3, videos: [video({ body: null })] }),
      ],
      { placeholderFloor: 1 }
    );

    expect({
      ships: result.ships,
      placeholders: result.placeholderLessons.length,
      withheld: result.withheldLessons.length,
    }).toEqual({ ships: 1, placeholders: 1, withheld: 1 });
  });

  it("reads as one line of three counts", () => {
    expect(
      formatPublishSummary({ ships: 48, placeholders: 12, withheld: 7 })
    ).toBe("ships 48 · placeholders 12 · withheld 7");
  });
});

describe("the publish page's Placeholder Floor cards", () => {
  const backlog = [
    lesson("p1-unfilmed", { priority: 1, videos: [] }),
    lesson("p2-unfilmed", { priority: 2, videos: [] }),
    lesson("p3-unfilmed", { priority: 3, videos: [] }),
  ];

  it("announces nothing by default, so every unfinished lesson is withheld", () => {
    const result = statuses(backlog);
    expect(paths(result.placeholderLessons)).toEqual([]);
    expect(paths(result.withheldLessons)).toEqual([
      "p1-unfilmed",
      "p2-unfilmed",
      "p3-unfilmed",
    ]);
  });

  it("moves a lesson from the withheld card to the placeholder card as the floor drops", () => {
    expect(
      paths(statuses(backlog, { placeholderFloor: 1 }).placeholderLessons)
    ).toEqual(["p1-unfilmed"]);
    expect(
      paths(statuses(backlog, { placeholderFloor: 2 }).placeholderLessons)
    ).toEqual(["p1-unfilmed", "p2-unfilmed"]);
    expect(
      paths(statuses(backlog, { placeholderFloor: 3 }).withheldLessons)
    ).toEqual([]);
  });

  it("carries each announced lesson's priority, so the card can name its band", () => {
    const result = statuses(backlog, { placeholderFloor: 3 });
    expect(
      result.placeholderLessons.map((row) => ({
        lessonPath: row.lessonPath,
        priority: row.priority,
      }))
    ).toEqual([
      { lessonPath: "p1-unfilmed", priority: 1 },
      { lessonPath: "p2-unfilmed", priority: 2 },
      { lessonPath: "p3-unfilmed", priority: 3 },
    ]);
  });

  it("names a reason on every withheld lesson", () => {
    const result = statuses(
      [
        lesson("no-video", { videos: [] }),
        lesson("no-clips", { videos: [video({ clips: 0 })] }),
        lesson("no-body", { videos: [video({ body: null })] }),
        lesson("unmarked", { authoringStatus: "todo" }),
      ],
      { includeTodoLessons: false }
    );

    expect(
      result.withheldLessons.map((row) => [row.lessonPath, row.reason])
    ).toEqual([
      ["no-video", "no-videos"],
      ["no-clips", "no-clips"],
      ["no-body", "no-body"],
      ["unmarked", "todo"],
    ]);
  });

  it("has a label for every reason it can name", () => {
    const result = statuses(
      [
        lesson("no-video", { videos: [] }),
        lesson("no-clips", { videos: [video({ clips: 0 })] }),
        lesson("no-body", { videos: [video({ body: null })] }),
        lesson("unmarked", { authoringStatus: "todo" }),
      ],
      { includeTodoLessons: false }
    );

    for (const row of result.withheldLessons) {
      expect(WITHHELD_REASON_LABELS[row.reason]).toBeTruthy();
    }
  });

  it("stacks both controls: the floor wins in its bands, and the toggle still withholds a shippable to-do lesson", () => {
    const result = statuses(
      [
        lesson("p1-unfilmed-todo", {
          priority: 1,
          authoringStatus: "todo",
          videos: [],
        }),
        lesson("p3-finished-todo", { priority: 3, authoringStatus: "todo" }),
      ],
      { includeTodoLessons: false, placeholderFloor: 1 }
    );

    // The floor beats the toggle inside the band it names…
    expect(paths(result.placeholderLessons)).toEqual(["p1-unfilmed-todo"]);
    // …and outside it the toggle keeps its own remaining job.
    expect(
      result.withheldLessons.map((row) => [row.lessonPath, row.reason])
    ).toEqual([["p3-finished-todo", "todo"]]);
  });

  // The withheld card must never make a Lesson look one toggle from shipping.
  // `todo` takes precedence over a hard gap in the verdict itself — that order
  // is load-bearing for collectPublishBlockers — so the gaps have to be shown
  // beside the reason or the label would send the author to a control that
  // cannot help.
  it("carries the hard gaps of a lesson the to-do toggle withheld", () => {
    const result = statuses(
      [
        lesson("todo-and-unfilmed", {
          authoringStatus: "todo",
          videos: [video({ clips: 0, body: null })],
        }),
      ],
      { includeTodoLessons: false }
    );

    const row = result.withheldLessons[0]!;
    expect(row.reason).toBe("todo");
    expect(row.hardGaps).toEqual(["no-clips", "no-body"]);
    expect(formatHardGaps(row.hardGaps)).toBe("no clips, no body");
  });

  it("names no gaps on a shippable lesson the toggle alone is holding back", () => {
    const result = statuses(
      [lesson("finished-todo", { authoringStatus: "todo" })],
      {
        includeTodoLessons: false,
      }
    );

    expect(result.withheldLessons[0]!.hardGaps).toEqual([]);
    // Nothing to show: here flipping the toggle really is the whole fix.
    expect(formatHardGaps(result.withheldLessons[0]!.hardGaps)).toBe(null);
  });

  it("keeps two courses' remembered floors apart", () => {
    expect(placeholderFloorStorageKey("course-a")).not.toBe(
      placeholderFloorStorageKey("course-b")
    );
  });
});
