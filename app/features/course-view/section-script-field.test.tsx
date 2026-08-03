import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { SectionScriptField } from "./section-script-field";

/**
 * The field autosaves through a fetcher, so it only renders inside a data
 * router — a memory router with the field as its one route is the cheapest way
 * to give it one.
 */
const renderInRouter = (element: ReactNode) =>
  renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter([{ path: "/", element }])} />
  );

const render = (props: { script: string; collapsed: boolean }) =>
  renderInRouter(
    <SectionScriptField
      videoId="v1"
      title="Introducing the problem"
      initialScript={props.script}
      readOnly={false}
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
});
