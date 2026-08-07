import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { COMMIT_MAP_COMPONENTS } from "./commit-map-components";

/**
 * The card is checked through the real renderer, not by calling it directly.
 * Its breach checks read the element tree react-markdown builds, and that tree
 * is the thing worth pinning: a check written against the wrong element type
 * fails silently, showing a clean card over broken markup.
 */
function render(body: string) {
  return renderToStaticMarkup(
    <AIResponse
      imageBasePath="/videos/1"
      extraComponents={COMMIT_MAP_COMPONENTS}
    >
      {body}
    </AIResponse>
  );
}

const CONTIGUOUS = `<CommitMap>
  <Commit id="main">The course start</Commit>
  <Commit id="add-settings-json">See my solution</Commit>
</CommitMap>`;

const BLANK_LINE = `<CommitMap>
  <Commit id="main">The course start</Commit>

  <Commit id="add-settings-json">See my solution</Commit>
</CommitMap>`;

const REPEATED = `<CommitMap>
  <Commit id="main">The course start</Commit>
  <Commit id="main">Again</Commit>
</CommitMap>`;

describe("commit map card", () => {
  it("draws an entry with its id, description and commands", () => {
    const html = render(CONTIGUOUS);

    expect(html).toContain("add-settings-json");
    expect(html).toContain("See my solution");
    expect(html).toContain("pnpm reset add-settings-json");
    expect(html).toContain("pnpm cherry-pick add-settings-json");
  });

  it("offers no cherry-pick for main", () => {
    const html = render(CONTIGUOUS);

    expect(html).toContain("pnpm reset main");
    expect(html).not.toContain("pnpm cherry-pick main");
  });

  it("reports nothing against a contiguous map", () => {
    expect(render(CONTIGUOUS)).not.toContain("blank line");
  });

  it("reports a blank line inside the block", () => {
    // The wrapper the blank line introduces is not a `p` element by the time
    // it reaches the card — the preview maps `p` to its own component — so the
    // check reads "not an entry" instead.
    expect(render(BLANK_LINE)).toContain("blank line");
  });

  it("still finds a repeated id when a blank line has nested the entries", () => {
    const html = render(`<CommitMap>
  <Commit id="main">The course start</Commit>

  <Commit id="main">Again</Commit>
</CommitMap>`);

    expect(html).toContain("more than once");
  });

  it("reports a repeated id", () => {
    expect(render(REPEATED)).toContain("more than once");
  });

  it("reports an entry with no id", () => {
    const html = render(`<CommitMap>
  <Commit>Nameless</Commit>
</CommitMap>`);

    expect(html).toContain("no id");
  });

  it("is static — it draws no buttons", () => {
    expect(render(CONTIGUOUS)).not.toContain("<button");
  });
});
