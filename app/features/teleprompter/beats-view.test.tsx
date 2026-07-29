import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeatsView } from "./beats-view";

const render = (description: string) =>
  renderToStaticMarkup(
    <BeatsView
      beats={[
        { id: "beat-1", kind: "definition", title: "The setup", description },
      ]}
    />
  );

describe("BeatsView", () => {
  // Beat descriptions are pasted notes as often as written ones, so a URL or a
  // long path turns up here too — and must not run off the right edge.
  it("breaks a word too long for the measure instead of overflowing", () => {
    expect(render("https://example.com/a/really/long/path")).toMatch(
      /overflow-wrap:\s*anywhere/
    );
  });

  it("links an address in a beat's description", () => {
    const html = render("Show https://example.com/pricing on screen.");
    expect(html).toContain('href="https://example.com/pricing"');
    expect(html).toContain('target="_blank"');
  });

  it("leaves a description with no address alone", () => {
    expect(render("Walk through the setup.")).toContain(
      "Walk through the setup."
    );
  });
});
