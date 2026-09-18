import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BeatLearningGoalOptions,
  type BeatLearningGoalOption,
} from "./beat-learning-goals-picker";

/**
 * The popover body is rendered on its own rather than through
 * `BeatLearningGoalsPicker`: Radix mounts `PopoverContent` in a portal, which
 * `renderToStaticMarkup` cannot render at all.
 *
 * Whether a row wraps or clips is decided by Tailwind at paint time, so no
 * test at this tier can see it — that one is checked by eye, per the Testing
 * section of CODING_STANDARDS.md. What is testable is the list's contract:
 * which rows read as checked, and what an author sees when a title or the
 * Section itself is empty.
 */
const render = (
  options: BeatLearningGoalOption[],
  selectedIds: string[] = []
) =>
  renderToStaticMarkup(
    <BeatLearningGoalOptions
      options={options}
      selectedIds={selectedIds}
      onToggle={() => {}}
    />
  );

describe("BeatLearningGoalOptions", () => {
  it("checks the Learning Goals this Beat already serves", () => {
    const html = render(
      [
        { id: "g1", title: "Fractional indexing" },
        { id: "g2", title: "Cycle detection" },
      ],
      ["g2"]
    );

    expect([...html.matchAll(/aria-checked="true"/g)]).toHaveLength(1);
    expect([...html.matchAll(/aria-checked="false"/g)]).toHaveLength(1);
  });

  it("names an untitled Learning Goal rather than rendering an empty row", () => {
    expect(render([{ id: "g1", title: "" }])).toContain("(untitled)");
  });

  it("says so when the Section has no Learning Goals yet", () => {
    expect(render([])).toContain("This Section has no Learning Goals yet.");
  });
});
