import { Pencil, Plus, Trash2 } from "lucide-react";
import { describe, expect, it } from "vitest";
import { bundle, labelProblems, layoutActionMenu } from "./action-menu-model";

const noop = () => {};

describe("layoutActionMenu", () => {
  it("orders groups canonically, whatever order the caller declares them in", () => {
    const laidOut = layoutActionMenu({
      danger: [{ label: "Delete", icon: Trash2, onSelect: noop }],
      create: [{ label: "Add Lesson", icon: Plus, onSelect: noop }],
      edit: [{ label: "Rename", icon: Pencil, onSelect: noop }],
    });
    expect(laidOut.map((g) => g.group)).toEqual(["edit", "create", "danger"]);
  });

  it("drops hidden items and the groups they leave empty", () => {
    const laidOut = layoutActionMenu({
      edit: [false, null, undefined],
      move: [{ label: "Move Up", icon: Plus, onSelect: noop }],
    });
    expect(laidOut.map((g) => g.group)).toEqual(["move"]);
  });

  it("marks every danger item destructive, and nothing else", () => {
    const laidOut = layoutActionMenu({
      edit: [{ label: "Rename", icon: Pencil, onSelect: noop }],
      danger: [{ label: "Delete", icon: Trash2, onSelect: noop }],
    });
    expect(
      laidOut.flatMap((g) => g.items.map((i) => [i.label, i.destructive]))
    ).toEqual([
      ["Rename", false],
      ["Delete", true],
    ]);
  });

  it("adds the ellipsis to items that open a dialog", () => {
    const [group] = layoutActionMenu({
      edit: [
        { label: "Rename", icon: Pencil, onSelect: noop, opensDialog: true },
        { label: "Mark as Done", icon: Pencil, onSelect: noop },
      ],
    });
    expect(group?.items.map((i) => i.label)).toEqual([
      "Rename…",
      "Mark as Done",
    ]);
  });

  it("closes the copy group with the appended items, even when the caller declares none", () => {
    const appended = [{ label: "Copy Link", icon: Plus, onSelect: noop }];
    expect(
      layoutActionMenu(
        { copy: [{ label: "Copy Transcript", icon: Plus, onSelect: noop }] },
        appended
      )
        .find((g) => g.group === "copy")
        ?.items.map((i) => i.label)
    ).toEqual(["Copy Transcript", "Copy Link"]);
    expect(layoutActionMenu({}, appended).map((g) => g.group)).toEqual([
      "copy",
    ]);
  });

  it("lays out one level of submenu, dropping its hidden leaves", () => {
    const [group] = layoutActionMenu({
      move: [
        {
          label: "Move to Section",
          icon: Plus,
          items: [{ label: "Intro", icon: Plus, onSelect: noop }, false],
        },
      ],
    });
    const submenu = group?.items[0];
    expect(submenu?.kind).toBe("submenu");
    expect(submenu?.kind === "submenu" && submenu.items.length).toBe(1);
  });

  it("bundles rare actions into a submenu, but leaves a lone one at the top level", () => {
    const copy = (label: string) => ({ label, icon: Plus, onSelect: noop });
    const labels = (items: Parameters<typeof bundle>[2]) =>
      layoutActionMenu({ copy: [bundle("Copy", Plus, items)] }).flatMap((g) =>
        g.items.map((i) => `${i.kind}:${i.label}`)
      );
    expect(labels([copy("Copy Log Path"), copy("Copy Chapters")])).toEqual([
      "submenu:Copy",
    ]);
    expect(labels([copy("Copy Log Path"), false])).toEqual([
      "leaf:Copy Log Path",
    ]);
    expect(labels([false])).toEqual([]);
  });

  it("lays out a picker as runs of options under their headings", () => {
    const [group] = layoutActionMenu({
      edit: [
        {
          label: "Change Pitch",
          icon: Plus,
          value: "b",
          onValueChange: noop,
          options: [
            { value: "a", label: "A", heading: "Live" },
            { value: "b", label: "B", heading: "Live" },
            { value: "c", label: "C", heading: "Idea" },
          ],
        },
      ],
    });
    const picker = group?.items[0];
    expect(picker?.kind).toBe("picker");
    expect(
      picker?.kind === "picker" &&
        picker.runs.map((r) => [r.heading, r.options.map((o) => o.value)])
    ).toEqual([
      ["Live", ["a", "b"]],
      ["Idea", ["c"]],
    ]);
  });
});

describe("labelProblems", () => {
  it.each([
    "Rename",
    "Add Section Before",
    "Move to Lesson",
    "Copy ID",
    "Reveal in File System",
    "Write to {folder}/readme.md",
  ])("accepts %s", (label) => {
    expect(labelProblems(label)).toEqual([]);
  });

  it("rejects sentence case", () => {
    expect(labelProblems("Add beat before")).toEqual([
      '"beat" should be capitalised (Title Case)',
      '"before" should be capitalised (Title Case)',
    ]);
  });

  it("rejects a hand-written ellipsis", () => {
    expect(labelProblems("Rename…")).toHaveLength(1);
    expect(labelProblems("Rename...")).toHaveLength(1);
  });

  it("capitalises a minor word that ends the label", () => {
    expect(labelProblems("Move to")).toEqual([
      '"to" should be capitalised (Title Case)',
    ]);
  });
});
