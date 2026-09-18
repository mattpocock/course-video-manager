import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonDescriptionField } from "./lesson-description-field";

const render = (props: {
  description: string;
  compact: boolean;
  isReadOnly?: boolean;
}) =>
  renderToStaticMarkup(
    <LessonDescriptionField
      description={props.description}
      isReadOnly={props.isReadOnly ?? false}
      compact={props.compact}
      onSave={() => {}}
    />
  );

describe("LessonDescriptionField", () => {
  it("shows the description in the expanded view", () => {
    expect(
      render({ description: "Why routers need a matcher", compact: false })
    ).toContain("Why routers need a matcher");
  });

  // The bug this component was extracted for: the compact view dropped the
  // description outright, so the display setting had nothing to turn on.
  it("shows the description in the compact view too", () => {
    expect(
      render({ description: "Why routers need a matcher", compact: true })
    ).toContain("Why routers need a matcher");
  });

  it("offers to add one when the expanded view has no description", () => {
    expect(render({ description: "", compact: false })).toContain(
      "Add description"
    );
  });

  // Compact is a density setting, so an empty description costs no height —
  // the context menu's Edit Description is the way in (lesson-context-menu.tsx).
  it("renders nothing when the compact view has no description", () => {
    expect(render({ description: "", compact: true })).toBe("");
  });

  it("does not offer to add one on a read-only version", () => {
    expect(
      render({ description: "", compact: false, isReadOnly: true })
    ).not.toContain("Add description");
  });

  // Read-only is a published version of the course: still worth reading, never
  // worth clicking, so the text stays and the click-to-edit affordance goes.
  it("shows a read-only description without the click-to-edit affordance", () => {
    const html = render({
      description: "Why routers need a matcher",
      compact: false,
      isReadOnly: true,
    });

    expect(html).toContain("Why routers need a matcher");
    expect(html).not.toContain("cursor-pointer");
  });

  it("shows a read-only description in the compact view", () => {
    expect(
      render({
        description: "Why routers need a matcher",
        compact: true,
        isReadOnly: true,
      })
    ).toContain("Why routers need a matcher");
  });

  it("renders no editor at all in the compact view", () => {
    const html = render({
      description: "Why routers need a matcher",
      compact: true,
    });

    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Add description");
  });
});
