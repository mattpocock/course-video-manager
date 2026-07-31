import { describe, it, expect } from "vitest";
import {
  INITIAL_NAV,
  currentPage,
  navReducer,
  type NavAction,
  type PaletteNav,
} from "./palette-nav";

/** Fold a sequence of actions, returning the final state and close flag. */
function run(actions: NavAction[], from: PaletteNav = INITIAL_NAV) {
  let nav = from;
  let close = false;
  for (const action of actions) {
    const result = navReducer(nav, action);
    nav = result.nav;
    close = result.close;
  }
  return { nav, close, page: currentPage(nav) };
}

describe("opening", () => {
  it("always lands on the root with an empty query", () => {
    const dirty: PaletteNav = {
      stack: ["root", "icons"],
      query: "datab",
      value: "database",
    };
    expect(run([{ type: "open" }], dirty).nav).toEqual(INITIAL_NAV);
  });

  it("can open straight onto a nested page", () => {
    // Ctrl+F opens on the diagram search rather than on the root list.
    expect(run([{ type: "open", page: "diagrams" }]).page).toBe("diagrams");
  });

  it("leaves the root underneath a page it opens onto", () => {
    // So Esc backs out to the full command list, exactly as it would have if
    // the page had been reached by picking the row.
    const result = run([
      { type: "open", page: "diagrams" },
      { type: "escape" },
    ]);
    expect(result.page).toBe("root");
    expect(result.close).toBe(false);
  });

  it("still clears a dirty query when opening onto a page", () => {
    const dirty: PaletteNav = {
      stack: ["root", "icons"],
      query: "datab",
      value: "database",
    };
    const { nav } = run([{ type: "open", page: "diagrams" }], dirty);
    expect(nav).toEqual({ stack: ["root", "diagrams"], query: "", value: "" });
  });
});

describe("push", () => {
  it("opens a nested page", () => {
    expect(run([{ type: "push", page: "icons" }]).page).toBe("icons");
  });

  it("clears both the query and the highlighted value", () => {
    const { nav } = run([
      { type: "setQuery", query: "snap" },
      { type: "setValue", value: "preserve-snapshot" },
      { type: "push", page: "icons" },
    ]);
    expect(nav.query).toBe("");
    expect(nav.value).toBe("");
  });
});

describe("pop", () => {
  it("steps back one level", () => {
    expect(run([{ type: "push", page: "icons" }, { type: "pop" }]).page).toBe(
      "root"
    );
  });

  it("clears the query and the value on the way back", () => {
    const { nav } = run([
      { type: "push", page: "icons" },
      { type: "setQuery", query: "datab" },
      { type: "setValue", value: "database" },
      { type: "pop" },
    ]);
    expect(nav.query).toBe("");
    expect(nav.value).toBe("");
  });

  it("means close when there is nothing left to pop", () => {
    expect(run([{ type: "pop" }]).close).toBe(true);
  });
});

describe("Escape", () => {
  it("backs out one level at a time rather than closing", () => {
    // A mis-typed query on the icon page must not throw you all the way out.
    const result = run([
      { type: "push", page: "icons" },
      { type: "setQuery", query: "xyzzy" },
      { type: "escape" },
    ]);
    expect(result.page).toBe("root");
    expect(result.close).toBe(false);
  });

  it("closes only at the root", () => {
    expect(run([{ type: "escape" }]).close).toBe(true);
  });

  it("unwinds a deep stack one press at a time", () => {
    const deep: NavAction[] = [
      { type: "push", page: "components" },
      { type: "push", page: "renameComponent" },
    ];
    expect(run([...deep, { type: "escape" }]).page).toBe("components");
    expect(run([...deep, { type: "escape" }, { type: "escape" }]).page).toBe(
      "root"
    );
    expect(
      run([...deep, { type: "escape" }, { type: "escape" }, { type: "escape" }])
        .close
    ).toBe(true);
  });
});

describe("Backspace", () => {
  it("steps back a level when the query is already empty", () => {
    expect(
      run([{ type: "push", page: "icons" }, { type: "backspace" }]).page
    ).toBe("root");
  });

  it("does nothing while there is still a query to delete", () => {
    const result = run([
      { type: "push", page: "icons" },
      { type: "setQuery", query: "d" },
      { type: "backspace" },
    ]);
    expect(result.page).toBe("icons");
    expect(result.nav.query).toBe("d");
  });

  it("never closes the palette from the root", () => {
    // Backspace at the root is just a backspace — only Esc closes.
    const result = run([{ type: "backspace" }]);
    expect(result.close).toBe(false);
    expect(result.page).toBe("root");
  });
});

describe("currentPage", () => {
  it("reads the top of the stack", () => {
    expect(
      currentPage({ stack: ["root", "components"], query: "", value: "" })
    ).toBe("components");
  });

  it("falls back to the root for an impossible empty stack", () => {
    expect(currentPage({ stack: [], query: "", value: "" })).toBe("root");
  });
});
