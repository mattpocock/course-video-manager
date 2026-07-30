import { describe, it, expect } from "vitest";
import { getIconNode } from "@/packages/lucide-icons";
import {
  PAGE_META,
  ROOT_ACTIONS,
  matchesComponentName,
  visibleRootActions,
  type PaletteSelection,
} from "./palette-model";

const NOTHING_SELECTED = { hasSelection: false, hasSingleIcon: false };
const SOMETHING_SELECTED = { hasSelection: true, hasSingleIcon: false };
const ONE_ICON_SELECTED = { hasSelection: true, hasSingleIcon: true };

const idsFor = (selection: PaletteSelection) =>
  visibleRootActions(selection).map((a) => a.id);

describe("visibleRootActions", () => {
  it("offers `save selection as component` once something is selected", () => {
    expect(idsFor(SOMETHING_SELECTED)).toContain("save-component");
  });

  it("omits it entirely when nothing is selected, rather than disabling it", () => {
    // Absent, not greyed out: the list stays short and everything in it is
    // actionable.
    expect(idsFor(NOTHING_SELECTED)).not.toContain("save-component");
  });

  it("offers `replace icon` for a lone selected icon", () => {
    expect(idsFor(ONE_ICON_SELECTED)).toContain("replace-icon");
  });

  it("omits `replace icon` for any other selection", () => {
    // There is no unambiguous answer for two icons or a mixed selection, and
    // none at all for a rectangle — so the row is absent, not a guess.
    expect(idsFor(SOMETHING_SELECTED)).not.toContain("replace-icon");
    expect(idsFor(NOTHING_SELECTED)).not.toContain("replace-icon");
  });

  it("hides nothing else as the selection narrows", () => {
    expect(idsFor(NOTHING_SELECTED).length).toBe(
      idsFor(SOMETHING_SELECTED).length - 1
    );
    expect(idsFor(SOMETHING_SELECTED).length).toBe(
      idsFor(ONE_ICON_SELECTED).length - 1
    );
  });
});

describe("the root action list", () => {
  it("gives every row a unique id", () => {
    // The id is the cmdk `value` for the row, so a duplicate would make two
    // rows highlight and fire as one.
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

  it("only opens pages that exist", () => {
    for (const action of ROOT_ACTIONS) {
      if (action.opens)
        expect(PAGE_META[action.opens], action.id).toBeDefined();
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

  it("matches a plain substring, whatever the case", () => {
    expect(filter("stack")).toEqual(["Three-tier stack"]);
    expect(filter("QUEUE")).toEqual(["Queue with workers"]);
  });

  it("does NOT match a fuzzy subsequence — cmdk's default is overridden", () => {
    // command-score returns 8 of 14 for "rt" and matches "queue" against
    // "Request/response pair". Both would make the grid feel broken.
    expect(filter("rt")).toEqual([]);
    expect(filter("queue")).not.toContain("Request/response pair");
  });

  it("matches everything for an empty or whitespace-only query", () => {
    expect(filter("")).toEqual(LIBRARY);
    expect(filter("   ")).toEqual(LIBRARY);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filter("  loop ")).toEqual(["Retry loop"]);
  });
});
