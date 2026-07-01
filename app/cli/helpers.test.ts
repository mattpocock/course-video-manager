import { describe, it, expect } from "vitest";
import { displayName, withName } from "@/cli/helpers";

describe("displayName — the uniform label of any row", () => {
  it("prefers a real `name` (course/version shape)", () => {
    expect(displayName({ name: "Alpha", title: "ignored" })).toBe("Alpha");
  });

  it("falls back to `title` when there is no name (pitch/deliverable/lesson)", () => {
    expect(displayName({ title: "Active pitch" })).toBe("Active pitch");
  });

  it("falls back to `path` when there is neither name nor title (section/video)", () => {
    expect(displayName({ path: "01-intro" })).toBe("01-intro");
  });

  it("prefers title over path (lesson with a title)", () => {
    expect(displayName({ title: "Welcome", path: "01-welcome" })).toBe(
      "Welcome"
    );
  });

  it("treats an empty title as absent and falls through to path (bare ghost lesson)", () => {
    expect(displayName({ title: "", path: "01-welcome" })).toBe("01-welcome");
  });

  it("ignores non-string / empty label fields", () => {
    expect(displayName({ name: "", title: null, path: undefined })).toBeNull();
    expect(displayName({ name: 42 })).toBeNull();
  });

  it("returns null for a row with no label-bearing field", () => {
    expect(displayName({ id: "x" })).toBeNull();
    expect(displayName(undefined)).toBeNull();
  });
});

describe("withName — prepend a normalised name onto a row", () => {
  it("adds `name` while preserving every existing field", () => {
    const row = { id: "p1", title: "Active pitch", priority: 2 };
    expect(withName(row)).toEqual({
      name: "Active pitch",
      id: "p1",
      title: "Active pitch",
      priority: 2,
    });
  });

  it("never clobbers an existing real name", () => {
    expect(withName({ id: "c1", name: "Alpha" }).name).toBe("Alpha");
  });
});
