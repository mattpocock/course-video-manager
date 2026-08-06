import { describe, expect, it } from "vitest";
import {
  splitAutofillClearable,
  type PublishBlockerLists,
} from "./publish-blockers";
import type { AutofillCandidate } from "@/services/autofill-candidates";

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
