import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClipMarks, ClipMarkState } from "@/lib/teleprompter-protocol";
import { fitMarks, MAX_MARKS, SessionMarks } from "./session-marks";

const repeat = (state: ClipMarkState, n: number): ClipMarks =>
  Array.from({ length: n }, () => state);

const render = (marks: ClipMarks) =>
  renderToStaticMarkup(<SessionMarks marks={marks} />);

/** The `data-mark` of each dot, in the order they're drawn. */
const drawn = (html: string) =>
  Array.from(html.matchAll(/data-mark="([^"]+)"/g)).map((m) => m[1]);

/** The inline style of the dot at `index`. */
const styleOf = (html: string, index: number) => {
  const dots = Array.from(html.matchAll(/<div[^>]*data-mark="[^"]*"[^>]*>/g));
  return dots[index]![0];
};

describe("SessionMarks", () => {
  it("draws nothing at all when there is no session", () => {
    expect(render([])).toBe("");
  });

  it("draws one dot per clip, in order", () => {
    expect(drawn(render(["landed", "pending", "orphaned"]))).toEqual([
      "landed",
      "pending",
      "orphaned",
    ]);
  });

  it("offers a click only on a dot whose Clip is on the timeline to play", () => {
    const html = renderToStaticMarkup(
      <SessionMarks
        marks={[
          "landed",
          "pending",
          "orphaned",
          "deleted-pending",
          "deleted-landed",
        ]}
        clipIds={["a", "b", "c", "d", "e"]}
        onMarkClicked={() => {}}
      />
    );
    const clickable = (i: number) => {
      const dot = styleOf(html, i);
      return dot.includes('role="button"') || dot.includes("cursor-pointer");
    };
    expect([0, 1, 2, 3, 4].map(clickable)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("shows the folded count on a take too long to draw", () => {
    const html = render(repeat("landed", MAX_MARKS + 7));
    expect(html).toContain("+7");
  });
});

describe("fitMarks", () => {
  it("shows everything when the take fits", () => {
    const marks = repeat("landed", MAX_MARKS);
    expect(fitMarks(marks)).toEqual({ shown: marks, folded: 0 });
  });

  it("folds the oldest landed marks away on a long take", () => {
    const marks: ClipMarks = [...repeat("landed", MAX_MARKS), "pending"];
    const { shown, folded } = fitMarks(marks);

    expect(shown).toHaveLength(MAX_MARKS);
    expect(folded).toBe(1);
    // The newest mark is the one you're watching, so it must survive.
    expect(shown.at(-1)).toBe("pending");
  });

  it("never folds away an unlanded mark", () => {
    // The leak this display exists to catch is an old hollow dot. It must not
    // scroll silently off the top just because the take ran long.
    const marks: ClipMarks = [
      "orphaned",
      ...repeat("landed", MAX_MARKS * 2),
      "pending",
    ];
    const { shown, folded } = fitMarks(marks);

    expect(shown).toHaveLength(MAX_MARKS);
    expect(shown[0]).toBe("orphaned");
    expect(shown.at(-1)).toBe("pending");
    expect(shown.filter((m) => m === "landed")).toHaveLength(MAX_MARKS - 2);
    expect(folded).toBe(marks.length - MAX_MARKS);
  });

  it("keeps the newest when even the unlanded marks overflow", () => {
    const marks = repeat("orphaned", MAX_MARKS + 5);
    const { shown, folded } = fitMarks(marks);

    expect(shown).toHaveLength(MAX_MARKS);
    expect(folded).toBe(5);
  });
});
