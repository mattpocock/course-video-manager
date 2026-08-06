import { describe, expect, it } from "vitest";
import {
  splitAutofillClearable,
  type PublishBlockerLists,
} from "./publish-blockers";

const lists = (
  overrides: Partial<PublishBlockerLists> = {}
): PublishBlockerLists => ({
  courseViewLints: [],
  incompleteVideos: [],
  invalidLessonCombos: [],
  ...overrides,
});

const videoLint = (
  kind: "missingChapters" | "missingDescription" | "missingBody"
) => ({
  scope: "video" as const,
  sectionPath: "01-intro",
  lessonPath: "01.01-welcome",
  videoTitle: "Explainer",
  kind,
});

describe("grouping the publish page's blockers", () => {
  it("folds away the two signals the Autofill owns", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        courseViewLints: [
          videoLint("missingChapters"),
          videoLint("missingDescription"),
        ],
      })
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
            sectionPath: "01-intro",
            lessonPath: "01.01-welcome",
            kind: "duplicateRoles",
          },
        ],
        invalidLessonCombos: [
          {
            sectionPath: "01-intro",
            lessonPath: "01.01-welcome",
            videoTitles: ["Explainer", "Problem"],
          },
        ],
      })
    );

    expect(clearable.courseViewLints).toHaveLength(0);
    expect(clearable.invalidLessonCombos).toHaveLength(0);
    expect(mine.courseViewLints).toHaveLength(2);
    expect(mine.invalidLessonCombos).toHaveLength(1);
  });

  it("only folds away an incomplete Video whose one gap is its description", () => {
    const { clearable, mine } = splitAutofillClearable(
      lists({
        incompleteVideos: [
          {
            sectionPath: "01-intro",
            lessonPath: "01.01-welcome",
            videoTitle: "One press away",
            missing: ["description"],
          },
          {
            sectionPath: "01-intro",
            lessonPath: "01.02-next",
            videoTitle: "Needs a body too",
            missing: ["body", "description"],
          },
          {
            sectionPath: "01-intro",
            lessonPath: "01.03-later",
            videoTitle: "Not even filmed",
            missing: ["clips"],
          },
        ],
      })
    );

    expect(clearable.incompleteVideos.map((v) => v.videoTitle)).toEqual([
      "One press away",
    ]);
    expect(mine.incompleteVideos.map((v) => v.videoTitle)).toEqual([
      "Needs a body too",
      "Not even filmed",
    ]);
  });

  it("loses no blocker: every one is still listed somewhere", () => {
    const all = lists({
      courseViewLints: [videoLint("missingChapters"), videoLint("missingBody")],
      incompleteVideos: [
        {
          sectionPath: "01-intro",
          lessonPath: "01.01-welcome",
          videoTitle: "Explainer",
          missing: ["description"],
        },
      ],
      invalidLessonCombos: [
        {
          sectionPath: "01-intro",
          lessonPath: "01.02-next",
          videoTitles: ["Explainer", "Problem"],
        },
      ],
    });
    const { clearable, mine } = splitAutofillClearable(all);

    const count = (l: PublishBlockerLists) =>
      l.courseViewLints.length +
      l.incompleteVideos.length +
      l.invalidLessonCombos.length;

    expect(count(clearable) + count(mine)).toBe(count(all));
  });
});
