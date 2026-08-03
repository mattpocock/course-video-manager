import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { SectionScriptsView } from "./section-scripts-view";
import type { SectionForScripts } from "./section-scripts-utils";

const renderInRouter = (element: ReactNode) =>
  renderToStaticMarkup(
    <RouterProvider router={createMemoryRouter([{ path: "/", element }])} />
  );

const section: SectionForScripts = {
  lessons: [
    {
      id: "l1",
      title: "Routing",
      path: "routing",
      videos: [
        { id: "v1", title: "Intro", script: "Welcome back." },
        { id: "v2", title: "Deep dive", script: "" },
      ],
    },
  ],
};

describe("SectionScriptsView", () => {
  it("offers a control to fold every script at once", () => {
    const html = renderInRouter(
      <SectionScriptsView section={section} readOnly={false} />
    );

    // Nothing is folded on a first visit, so the control folds rather than unfolds.
    expect(html).toContain("Collapse all");
    expect(html).not.toContain("Expand all");
  });

  it("starts every script unfolded", () => {
    const html = renderInRouter(
      <SectionScriptsView section={section} readOnly={false} />
    );

    expect([...html.matchAll(/<textarea/g)]).toHaveLength(2);
    expect([...html.matchAll(/aria-expanded="true"/g)]).toHaveLength(2);
  });

  it("has nothing to fold in a section with no videos", () => {
    const html = renderInRouter(
      <SectionScriptsView
        section={{
          lessons: [{ id: "l1", title: "Empty", path: "empty", videos: [] }],
        }}
        readOnly={false}
      />
    );

    expect(html).toContain("This section has no videos yet.");
    expect(html).not.toContain("Collapse all");
  });
});
