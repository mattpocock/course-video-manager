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
});
