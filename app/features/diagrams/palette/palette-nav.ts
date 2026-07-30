/**
 * The palette's page stack, as a pure reducer.
 *
 * cmdk has no `pages` prop, so the stack is userland. It is extracted from
 * React deliberately: CVM has no browser or component test infrastructure, so
 * the only way this behaviour gets tested is by being a plain function.
 */

export type PageKey =
  | "root"
  | "icons"
  | "replaceIcon"
  | "components"
  | "diagrams"
  | "nameComponent"
  | "renameComponent"
  | "renameDiagram";

export type PaletteNav = {
  stack: PageKey[];
  query: string;
  value: string;
};

/** Opening always lands here, whatever the last session did. */
export const INITIAL_NAV: PaletteNav = {
  stack: ["root"],
  query: "",
  value: "",
};

export type NavAction =
  | { type: "open" }
  /** A row that opens a further page rather than firing immediately. */
  | { type: "push"; page: PageKey }
  | { type: "pop" }
  | { type: "setQuery"; query: string }
  | { type: "setValue"; value: string }
  | { type: "escape" }
  | { type: "backspace" };

export type NavResult = {
  nav: PaletteNav;
  /** True when the action should dismiss the palette entirely. */
  close: boolean;
};

export function currentPage(nav: PaletteNav): PageKey {
  return nav.stack[nav.stack.length - 1] ?? "root";
}

export function navReducer(nav: PaletteNav, action: NavAction): NavResult {
  switch (action.type) {
    case "open":
      // Reset on every open, so the palette behaves the same way every time
      // regardless of what the last session did.
      return { nav: INITIAL_NAV, close: false };

    case "push":
      // push/pop clear BOTH the query and the highlighted value — a query left
      // over from the previous page would silently filter the new one.
      return {
        nav: { stack: [...nav.stack, action.page], query: "", value: "" },
        close: false,
      };

    case "pop":
    case "escape":
      // Esc backs out one level at a time, so a mis-typed query on the icon
      // page doesn't throw you all the way out. At the root there is nothing
      // left to pop, so it closes.
      if (nav.stack.length <= 1) return { nav, close: true };
      return {
        nav: { stack: nav.stack.slice(0, -1), query: "", value: "" },
        close: false,
      };

    case "backspace":
      // "Undo my way out" without reaching for Esc — but only once the query is
      // already empty, so backspacing through a query still works. Known side
      // effect: clearing a nested page's query with backspaces then kicks you
      // back to the parent.
      if (nav.query !== "" || nav.stack.length <= 1) {
        return { nav, close: false };
      }
      return {
        nav: { stack: nav.stack.slice(0, -1), query: "", value: "" },
        close: false,
      };

    case "setQuery":
      return { nav: { ...nav, query: action.query }, close: false };

    case "setValue":
      return { nav: { ...nav, value: action.value }, close: false };
  }
}
