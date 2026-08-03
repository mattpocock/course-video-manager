import { describe, expect, it } from "vitest";
import { renderInRouter } from "@/test-utils/render-in-router";
import { SectionScriptField } from "./section-script-field";

/** The field autosaves through a fetcher, so it only renders inside a router. */
const render = (props: {
  script: string;
  collapsed: boolean;
  readOnly?: boolean;
}) =>
  renderInRouter(
    <SectionScriptField
      videoId="v1"
      title="Introducing the problem"
      initialScript={props.script}
      readOnly={props.readOnly ?? false}
      collapsed={props.collapsed}
      onToggleCollapsed={() => {}}
      onOpenWriter={() => {}}
    />
  );

describe("SectionScriptField folding", () => {
  it("shows the editable script when expanded", () => {
    const html = render({
      script: "So today we build a router.\nStarting from scratch.",
      collapsed: false,
    });

    expect(html).toContain("<textarea");
    expect(html).toContain("Starting from scratch.");
    expect(html).toContain('aria-expanded="true"');
  });

  it("replaces the editor with a one-line preview when folded", () => {
    const html = render({
      script: "So today we build a router.\nStarting from scratch.",
      collapsed: true,
    });

    expect(html).not.toContain("<textarea");
    expect(html).toContain("So today we build a router.");
    expect(html).not.toContain("Starting from scratch.");
    expect(html).toContain('aria-expanded="false"');
  });

  // The title stays visible either way — that is what makes a folded document
  // still navigable.
  it("keeps the video title visible when folded", () => {
    expect(render({ script: "anything", collapsed: true })).toContain(
      "Introducing the problem"
    );
  });

  it("says so when a folded script has not been written yet", () => {
    expect(render({ script: "", collapsed: true })).toContain("No script yet");
  });

  // Reading a published version is exactly when folding earns its keep, so it
  // must not ride along with the edit affordances that read-only strips out.
  it("still folds on a read-only version", () => {
    const html = render({
      script: "So today we build a router.",
      collapsed: true,
      readOnly: true,
    });

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("So today we build a router.");
    expect(html).not.toContain("Open in writer");
  });

  it("keeps the heading out of the button, which only takes phrasing content", () => {
    expect(render({ script: "anything", collapsed: false })).not.toMatch(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*<h3/
    );
  });
});
