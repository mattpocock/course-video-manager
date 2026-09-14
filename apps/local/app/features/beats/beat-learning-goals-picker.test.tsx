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

/** Longer than the popover is wide, so a one-line row would clip it. */
const LONG_TITLE =
  "Understand why a fractional index beats an integer position when reordering a Section without rewriting every sibling row";

describe("BeatLearningGoalOptions", () => {
  it("renders a long Learning Goal title in full", () => {
    expect(render([{ id: "g1", title: LONG_TITLE }])).toContain(LONG_TITLE);
  });

  // Clipping is a CSS effect, so the class is the only thing static markup can
  // observe: a `truncate` row cuts the title off at one line however much of
  // it React wrote out.
  it("wraps a long title over several lines instead of clipping it", () => {
    const html = render([{ id: "g1", title: LONG_TITLE }]);

    expect(html).not.toContain("truncate");
    expect(html).toContain("break-words");
  });

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
