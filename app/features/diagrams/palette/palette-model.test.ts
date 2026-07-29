import { describe, it, expect } from "vitest";
import { getIconNode } from "@/packages/lucide-icons";
import {
  GROUP_ORDER,
  ROOT_ACTIONS,
  matchesComponentName,
} from "./palette-model";

describe("the root action list", () => {
  it("puts every action in one of the four groups", () => {
    for (const action of ROOT_ACTIONS) {
      expect(GROUP_ORDER, action.id).toContain(action.group);
    }
  });

  it("hides `save selection as component` unless something is selected", () => {
    const save = ROOT_ACTIONS.find((a) => a.id === "save-component");
    expect(save?.requiresSelection).toBe(true);
  });

  it("offers exactly the five mirrored snapshot and diagram actions", () => {
    const mirrored = ROOT_ACTIONS.filter(
      (a) => a.group === "Snapshot" || a.group === "Diagram"
    ).map((a) => a.id);
    expect(mirrored.sort()).toEqual([
      "copy-contents",
      "new-diagram",
      "preserve-snapshot",
      "rename-diagram",
      "restore-head",
    ]);
  });

  it("marks which rows open a page and which fire immediately", () => {
    // The right-aligned affordance is `→` vs `⏎`, so this has to be knowable
    // before Enter is pressed.
    const opens = ROOT_ACTIONS.filter((a) => a.opens).map((a) => a.id);
    expect(opens.sort()).toEqual([
      "go-to-diagram",
      "insert-component",
      "insert-icon",
      // Rename needs a name, and the palette's own input is where it is typed.
      "rename-diagram",
      "save-component",
    ]);
  });

  it("has unique ids", () => {
    const ids = ROOT_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names an icon the frozen table actually carries", () => {
    // The picker draws from the vendored table, not from lucide-react, so a
    // name lucide has since renamed (`history` -> `rotate-ccw-clock`) renders
    // nothing at all rather than falling back.
    for (const action of ROOT_ACTIONS) {
      expect(getIconNode(action.icon), action.icon).toBeDefined();
    }
  });
});

describe("matchesComponentName", () => {
  const LIBRARY = [
    "Request/response pair",
    "Three-tier stack",
    "Queue with workers",
    "Retry loop",
  ];
  const filter = (q: string) =>
    LIBRARY.filter((name) => matchesComponentName(name, q));

  it("matches a plain substring", () => {
    expect(filter("stack")).toEqual(["Three-tier stack"]);
  });

  it("is case-insensitive", () => {
    expect(filter("QUEUE")).toEqual(["Queue with workers"]);
  });

  it("does NOT match a fuzzy subsequence — cmdk's default is overridden", () => {
    // command-score returns 8 of 14 for "rt" and matches "queue" against
    // "Request/response pair". Both would make the grid feel broken.
    expect(filter("rt")).toEqual([]);
    expect(filter("queue")).not.toContain("Request/response pair");
  });

  it("matches everything for an empty or whitespace query", () => {
    expect(filter("")).toEqual(LIBRARY);
    expect(filter("   ")).toEqual(LIBRARY);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filter("  loop ")).toEqual(["Retry loop"]);
  });
});
