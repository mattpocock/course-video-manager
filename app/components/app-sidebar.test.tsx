import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { AppSidebar } from "./app-sidebar";

const render = (variant: "rail" | "floating") => {
  const Stub = createRoutesStub([
    {
      path: "/courses/:courseId",
      Component: () => <AppSidebar variant={variant} />,
    },
  ]);
  return renderToStaticMarkup(<Stub initialEntries={["/courses/course-1"]} />);
};

/** The class list of the element carrying the given data-slot, if present. */
const classesOf = (html: string, slot: string) => {
  const match = html.match(
    new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`)
  )?.[0];
  if (!match) return null;
  return match.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
};

describe("app sidebar rail", () => {
  it("sticks to the top of the viewport so it survives page scroll", () => {
    const classes = classesOf(render("rail"), "app-sidebar-rail");
    expect(classes).toContain("sticky");
    expect(classes).toContain("top-0");
  });

  it("is only as tall as the viewport so it can move within the layout", () => {
    // A stretched flex child fills the whole (scrollable) page, leaving sticky
    // nothing to stick within — the rail has to size and align to itself.
    const classes = classesOf(render("rail"), "app-sidebar-rail");
    expect(classes).toContain("h-screen");
    expect(classes).toContain("self-start");
  });

  it("scrolls its own overflowing content rather than clipping it", () => {
    const html = render("rail");
    expect(html).toContain("overflow-y-auto");
  });
});
