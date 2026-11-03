import { describe, it, expect } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { CvmIconShape } from "@/features/diagrams/cvm-icon-shape";
import { ROOT_ACTIONS } from "./palette-model";
import {
  INITIAL_NAV,
  createInitialPaletteState,
  currentPage,
  paletteReducer,
  selectComponents,
  type ComponentSummary,
  type DiagramHit,
  type PageKey,
} from "./palette-reducer";

const summoned = (
  page: PageKey | null = null,
  selection: { hasSelection?: boolean; selectedIcon?: CvmIconShape } = {}
): paletteReducer.Action => ({
  type: "palette-summoned",
  page,
  hasSelection: selection.hasSelection ?? false,
  selectedIcon: selection.selectedIcon ?? null,
  recentIcons: [],
});

const row = (id: string) => {
  const action = ROOT_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`no root action ${id}`);
  return { type: "root-action-picked" as const, action };
};

const tester = () =>
  new ReducerTester(paletteReducer, createInitialPaletteState());

const page = (t: ReturnType<typeof tester>) => currentPage(t.getState().nav);

const box: ComponentSummary = { id: "c1", name: "Box" };
const arrow: ComponentSummary = { id: "c2", name: "Arrow" };

/** Summoned onto the library, with two components listed. */
const onComponents = () =>
  tester()
    .send(summoned())
    .send(row("insert-component"))
    .send({ type: "components-listed", components: [box, arrow] })
    .resetExec();

const hit = (diagramId: string): DiagramHit => ({
  diagramId,
  snapshotId: "s1",
  diagramName: diagramId,
  contentHash: null,
  searchText: null,
  source: "snapshot",
});

describe("summoning", () => {
  it("always lands on the root with an empty query, whatever the last session did", () => {
    const t = tester()
      .send(summoned())
      .send(row("insert-icon"))
      .send({ type: "query-typed", query: "datab" })
      .send({ type: "highlight-moved", value: "database" })
      .send({ type: "palette-dismissed" })
      .send(summoned());
    expect(t.getState().open).toBe(true);
    expect(t.getState().nav).toEqual(INITIAL_NAV);
  });

  it("opens onto a page with the root beneath it, so Esc backs out instead of closing", () => {
    const t = tester().send(summoned("diagrams"));
    expect(page(t)).toBe("diagrams");
    t.send({ type: "escape-pressed" });
    expect(page(t)).toBe("root");
    expect(t.getState().open).toBe(true);
  });

  it("collapses a deep stack and clears its query, rather than piling onto it", () => {
    // Cmd+F pressed from two pages down is still "take me to the search".
    const t = onComponents()
      .send({ type: "rename-component-clicked", component: box })
      .send({ type: "query-typed", query: "Bo" })
      .send(summoned("diagrams"));
    expect(t.getState().nav).toEqual({
      stack: ["root", "diagrams"],
      query: "",
      value: "",
    });
  });

  it("searches again when Cmd+F is pressed a second time", () => {
    // Opened onto the search, Esc back to the root, Cmd+F again: never a dead
    // keypress.
    const t = tester()
      .send(summoned("diagrams"))
      .send({ type: "escape-pressed" })
      .send(summoned("diagrams"));
    expect(t.getEffects()).toEqual([
      { type: "search-diagrams", query: "", seq: 1, delayMs: 0 },
      { type: "search-diagrams", query: "", seq: 2, delayMs: 0 },
    ]);
  });

  it("is dismissed by a click away", () => {
    const t = tester().send(summoned()).send({ type: "palette-dismissed" });
    expect(t.getState().open).toBe(false);
  });
});

describe("the page stack", () => {
  it("clears the query and the highlight when a row opens a page", () => {
    const t = tester()
      .send(summoned())
      .send({ type: "query-typed", query: "ins" })
      .send({ type: "highlight-moved", value: "insert-icon" })
      .send(row("insert-icon"));
    expect(t.getState().nav).toEqual({
      stack: ["root", "icons"],
      query: "",
      value: "",
    });
  });

  it("unwinds one Esc at a time, clearing the query, and closes only at the root", () => {
    // A mis-typed query on a nested page must not throw you all the way out.
    const t = onComponents()
      .send({ type: "rename-component-clicked", component: box })
      .send({ type: "query-typed", query: "xyzzy" })
      .send({ type: "escape-pressed" });
    expect(page(t)).toBe("components");
    expect(t.getState().nav.query).toBe("");
    t.send({ type: "escape-pressed" });
    expect(page(t)).toBe("root");
    expect(t.getState().open).toBe(true);
    t.send({ type: "escape-pressed" });
    expect(t.getState().open).toBe(false);
  });

  it("steps back on Backspace only once the query is empty, and never closes", () => {
    const t = tester()
      .send(summoned())
      .send(row("insert-icon"))
      .send({ type: "query-typed", query: "d" })
      .send({ type: "backspace-pressed" });
    expect(page(t)).toBe("icons");
    expect(t.getState().nav.query).toBe("d");

    t.send({ type: "query-typed", query: "" }).send({
      type: "backspace-pressed",
    });
    expect(page(t)).toBe("root");

    t.send({ type: "backspace-pressed" });
    expect(page(t)).toBe("root");
    expect(t.getState().open).toBe(true);
  });

  it("reads the root for an impossible empty stack", () => {
    expect(currentPage({ stack: [], query: "", value: "" })).toBe("root");
  });
});

describe("root commands", () => {
  it("fire and close the palette", () => {
    const t = tester().send(summoned()).send(row("preserve-snapshot"));
    expect(t.getState().open).toBe(false);
    expect(t.getEffects()).toEqual([
      { type: "run-root-command", command: "preserve-snapshot" },
    ]);
  });
});

describe("icons", () => {
  it("closes when an icon lands, and records it as recent", () => {
    const t = tester()
      .send(summoned())
      .send(row("insert-icon"))
      .send({ type: "icon-picked", name: "database" })
      .send({ type: "icon-inserted", name: "database", landed: true });
    expect(t.getState().open).toBe(false);
    expect(t.getEffects()).toEqual([
      { type: "insert-icon", name: "database" },
      { type: "record-icon-use", name: "database" },
    ]);
  });

  it("stays up at the shape cap, and records nothing", () => {
    const t = tester()
      .send(summoned())
      .send(row("insert-icon"))
      .send({ type: "icon-picked", name: "database" })
      .send({ type: "icon-inserted", name: "database", landed: false });
    expect(t.getState().open).toBe(true);
    expect(t.getEffects()).toEqual([{ type: "insert-icon", name: "database" }]);
  });

  it("replaces the selected icon, and stays up with an error if it has gone", () => {
    const selectedIcon = fromPartial<CvmIconShape>({ id: "shape:icon1" });
    const t = tester()
      .send(summoned(null, { hasSelection: true, selectedIcon }))
      .send(row("replace-icon"))
      .send({ type: "replacement-icon-picked", name: "server" })
      .send({ type: "icon-replace-failed" });
    expect(t.getState().open).toBe(true);
    expect(t.getEffects()).toEqual([
      { type: "replace-icon", shapeId: "shape:icon1", name: "server" },
      { type: "report-error", message: "That icon is no longer on the canvas" },
    ]);

    t.send({ type: "replacement-icon-picked", name: "server" }).send({
      type: "icon-replaced",
    });
    expect(t.getState().open).toBe(false);
  });
});

describe("components", () => {
  it("lists the library on the way in, and filters it by name in its own order", () => {
    const t = tester().send(summoned()).send(row("insert-component"));
    expect(t.getEffects()).toEqual([{ type: "list-components" }]);

    t.send({ type: "components-listed", components: [box, arrow] }).send({
      type: "query-typed",
      query: "arr",
    });
    expect(selectComponents(t.getState())).toEqual([arrow]);
  });

  it("keeps the previous list when a re-list fails", () => {
    const t = onComponents()
      .send({ type: "escape-pressed" })
      .send(row("insert-component"))
      .send({ type: "components-list-failed" });
    expect(t.getState().components).toEqual([box, arrow]);
  });

  it("closes once a component lands, with the spinner only if it was slow", () => {
    const t = onComponents().send({
      type: "component-picked",
      component: box,
    });
    expect(t.getState().busy).toBe(false);
    t.send({ type: "spinner-delay-elapsed" });
    expect(t.getState().busy).toBe(true);

    t.send({ type: "component-inserted", landed: true });
    expect(t.getState()).toMatchObject({ open: false, busy: false });
    expect(t.getEffects()).toEqual([
      { type: "insert-component", componentId: "c1" },
      { type: "wait-for-spinner", delayMs: 150 },
      { type: "report-success" },
    ]);
  });

  it("ignores a second Enter while an insert is in flight, and stays up at the shape cap", () => {
    const t = onComponents()
      .send({ type: "component-picked", component: box })
      .send({ type: "component-picked", component: box })
      .send({ type: "component-inserted", landed: false });
    expect(t.getState()).toMatchObject({ open: true, working: false });
    expect(t.getEffects()).toEqual([
      { type: "insert-component", componentId: "c1" },
      { type: "wait-for-spinner", delayMs: 150 },
    ]);
  });

  it("drops the tile of a component another window deleted", () => {
    const t = onComponents()
      .send({ type: "component-picked", component: box })
      .send({
        type: "component-insert-failed",
        componentId: "c1",
        reason: "gone",
      });
    expect(t.getState().components).toEqual([arrow]);
    expect(t.getState().open).toBe(true);
    expect(t.getEffects()).toEqual([
      { type: "insert-component", componentId: "c1" },
      { type: "wait-for-spinner", delayMs: 150 },
      { type: "report-error", message: "That component no longer exists" },
    ]);
  });

  it("saves the selection under its trimmed name, and blocks an empty one", () => {
    const t = tester()
      .send(summoned(null, { hasSelection: true }))
      .send(row("save-component"))
      .send({ type: "name-submitted", name: "   " });
    expect(t.getEffects()).toEqual([]);

    t.send({ type: "name-submitted", name: " Server rack " }).send({
      type: "component-saved",
    });
    expect(t.getState().open).toBe(false);
    expect(t.getEffects()).toEqual([
      { type: "save-component", name: "Server rack" },
      { type: "wait-for-spinner", delayMs: 150 },
      { type: "report-success" },
    ]);
  });

  it("renames the component under edit and returns to the library showing the new name", () => {
    const t = onComponents()
      .send({ type: "rename-component-clicked", component: box })
      .send({ type: "query-typed", query: "Crate " })
      .send({ type: "name-submitted", name: "Crate " })
      .send({ type: "component-renamed", componentId: "c1", name: "Crate" });
    expect(page(t)).toBe("components");
    expect(t.getState().components).toEqual([
      { id: "c1", name: "Crate" },
      arrow,
    ]);
    expect(t.getEffects()).toEqual([
      { type: "rename-component", componentId: "c1", name: "Crate" },
      { type: "report-success" },
      { type: "list-components" },
    ]);
  });

  it("stays on the rename page when the rename fails", () => {
    const t = onComponents()
      .send({ type: "rename-component-clicked", component: box })
      .send({ type: "name-submitted", name: "Crate" })
      .send({ type: "component-rename-failed" });
    expect(page(t)).toBe("renameComponent");
    expect(t.getEffects()).toEqual([
      { type: "rename-component", componentId: "c1", name: "Crate" },
      { type: "report-error", message: "Couldn't rename that component" },
    ]);
  });

  it("removes a deleted component's tile, and keeps it when the delete fails", () => {
    const t = onComponents()
      .send({ type: "delete-component-clicked", componentId: "c2" })
      .send({ type: "component-delete-failed" });
    expect(t.getState().components).toEqual([box, arrow]);

    t.send({ type: "delete-component-clicked", componentId: "c2" }).send({
      type: "component-deleted",
      componentId: "c2",
    });
    expect(t.getState().components).toEqual([box]);
    expect(t.getEffects()).toEqual([
      { type: "delete-component", componentId: "c2" },
      { type: "report-error", message: "Couldn't delete that component" },
      { type: "delete-component", componentId: "c2" },
      { type: "report-success" },
    ]);
  });
});

describe("diagrams", () => {
  it("debounces typed searches and ignores an answer to an older one", () => {
    const t = tester()
      .send(summoned("diagrams"))
      .send({ type: "query-typed", query: "a" })
      .send({ type: "query-typed", query: "au " })
      .send({ type: "diagrams-found", seq: 2, hits: [hit("old")] });
    expect(t.getState()).toMatchObject({ diagramHits: [], searching: true });

    t.send({ type: "diagrams-found", seq: 3, hits: [hit("auth")] });
    expect(t.getState()).toMatchObject({
      diagramHits: [hit("auth")],
      searching: false,
    });
    expect(t.getEffects()).toEqual([
      { type: "search-diagrams", query: "", seq: 1, delayMs: 0 },
      { type: "search-diagrams", query: "a", seq: 2, delayMs: 180 },
      { type: "search-diagrams", query: "au", seq: 3, delayMs: 180 },
    ]);
  });

  it("goes to the whole hit picked, snapshot and all, and closes once there", () => {
    const t = tester()
      .send(summoned("diagrams"))
      .resetExec()
      .send({ type: "diagram-picked", hit: hit("auth") });
    expect(t.getState().open).toBe(true);
    expect(t.getEffects()).toEqual([
      { type: "go-to-diagram", target: hit("auth") },
    ]);

    t.send({ type: "went-to-diagram" });
    expect(t.getState().open).toBe(false);
  });

  it("renames the open diagram under its trimmed name, then closes", () => {
    const t = tester()
      .send(summoned())
      .send(row("rename-diagram"))
      .send({ type: "name-submitted", name: " Auth flow " })
      .send({ type: "diagram-renamed" });
    expect(t.getState().open).toBe(false);
    expect(t.getEffects()).toEqual([
      { type: "rename-diagram", name: "Auth flow" },
    ]);
  });
});
