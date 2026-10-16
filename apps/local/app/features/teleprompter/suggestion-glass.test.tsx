import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SuggestionGlass } from "./suggestion-glass";

const render = (text: string, previousClips: string[]) =>
  renderToStaticMarkup(
    <SuggestionGlass suggestion={{ id: 1, text, previousClips }} />
  );

describe("SuggestionGlass", () => {
  it("sets a previous Clip in exactly the suggestion's type", () => {
    const html = render("Now for **generics**.", ["So that's a **type**."]);

    // The previous Clip's wrapper adds nothing to the column's type: no size,
    // colour or opacity of its own.
    const wrapper = html.match(/<div[^>]*data-previous-clip[^>]*>/)![0];
    expect(wrapper).not.toContain("style=");

    // Bold reads the same in both.
    const strongs = Array.from(
      html.matchAll(/<strong[^>]*>([^<]*)<\/strong>/g)
    );
    expect(strongs.map((m) => m[1])).toEqual(["type", "generics"]);
    expect(strongs[0]![0].replace("type", "")).toBe(
      strongs[1]![0].replace("generics", "")
    );
  });

  it("keeps the previous Clips in order, above the suggestion", () => {
    const html = render("Next line.", ["one", "two", "three"]);
    const order = ["one", "two", "three", "Next line."].map((t) =>
      html.indexOf(t)
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });
});
