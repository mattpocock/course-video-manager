import type {
  EffectEntity,
  EffectReducer,
  EffectReducerExec,
} from "use-effect-reducer";
import type { CvmIconShape } from "@/features/diagrams/cvm-icon-shape";
import {
  matchesComponentName,
  visibleRootActions,
  type RootAction,
} from "./palette-model";

/**
 * The Cmd+K command palette, as a pure reducer: whether it is open, its page
 * stack, what the canvas selection was when it was summoned, and what each
 * page has loaded (recent icons, the component library, diagram hits).
 *
 * cmdk has no `pages` prop, so the stack is userland. Everything the palette
 * does to the outside world (the canvas, the server, the route's handlers) is
 * an effect, and its outcome comes back as an event. The selection and the
 * recent icons come in on `palette-summoned`, read by the caller, so the
 * reducer never reads the editor or storage.
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

export type ComponentSummary = { id: string; name: string };

export type DiagramHit = {
  diagramId: string;
  snapshotId: string | null;
  diagramName: string;
  contentHash: string | null;
  searchText: string | null;
  source: string;
};

/**
 * What "go to this result" needs to know. A hit carrying a `snapshotId` is a
 * request for THAT state, not for the diagram's head — see `onGoToDiagram`.
 */
export type DiagramTarget = Pick<
  DiagramHit,
  "diagramId" | "snapshotId" | "source"
>;

/** A root row that fires at once rather than opening a page. */
export type RootCommand =
  | "preserve-snapshot"
  | "restore-head"
  | "copy-contents"
  | "new-diagram"
  | "recentre-diagram";

/** Server-side diagram search is debounced by this much. */
export const SEARCH_DEBOUNCE_MS = 180;

/** No spinner below this, where it would only flicker. */
export const SPINNER_THRESHOLD_MS = 150;

/** Opening always lands here, whatever the last session did. */
export const INITIAL_NAV: PaletteNav = {
  stack: ["root"],
  query: "",
  value: "",
};

export namespace paletteReducer {
  export type State = {
    open: boolean;
    nav: PaletteNav;
    /** The canvas selection as of the last summon. */
    hasSelection: boolean;
    /** The lone selected icon, if the selection is exactly that. */
    selectedIcon: CvmIconShape | null;
    /** The icon grid's recents, as stored at the last summon. */
    recentIcons: string[];
    /** The library, in the server's recency order. */
    components: ComponentSummary[];
    /** The component the rename page is renaming. */
    componentUnderEdit: ComponentSummary | null;
    diagramHits: DiagramHit[];
    searching: boolean;
    /** The latest diagram search; an answer to any earlier one is ignored. */
    searchSeq: number;
    search: EffectEntity<State, Action> | null;
    /** A component save or insert is in flight. */
    working: boolean;
    /** The spinner shows once `working` has lasted past the threshold. */
    busy: boolean;
    spinnerDelay: EffectEntity<State, Action> | null;
  };

  export type Action =
    /** Summoned onto `page`, or onto the root list when that is null. */
    | {
        type: "palette-summoned";
        page: PageKey | null;
        hasSelection: boolean;
        selectedIcon: CvmIconShape | null;
        recentIcons: string[];
      }
    /** A click away, or the summon key pressed while it is open. */
    | { type: "palette-dismissed" }
    | { type: "escape-pressed" }
    | { type: "backspace-pressed" }
    | { type: "query-typed"; query: string }
    | { type: "highlight-moved"; value: string }
    | { type: "root-action-picked"; action: RootAction }
    | { type: "icon-picked"; name: string }
    /** The insert ran; `landed` is false at the page's shape cap. */
    | { type: "icon-inserted"; name: string; landed: boolean }
    /** Picked on the replace page, for the lone selected icon. */
    | { type: "replacement-icon-picked"; name: string }
    | { type: "icon-replaced" }
    | { type: "icon-replace-failed" }
    /** Enter on a name page: which page decides what the name is for. */
    | { type: "name-submitted"; name: string }
    | { type: "component-saved" }
    | {
        type: "component-save-failed";
        reason: "nothing-selected" | "capture-failed" | "request-failed";
      }
    | { type: "component-picked"; component: ComponentSummary }
    | { type: "component-inserted"; landed: boolean }
    | {
        type: "component-insert-failed";
        componentId: string;
        reason: "gone" | "request-failed" | "incompatible";
      }
    | { type: "rename-component-clicked"; component: ComponentSummary }
    | { type: "component-renamed"; componentId: string; name: string }
    | { type: "component-rename-failed" }
    | { type: "delete-component-clicked"; componentId: string }
    | { type: "component-deleted"; componentId: string }
    | { type: "component-delete-failed" }
    | { type: "components-listed"; components: ComponentSummary[] }
    | { type: "components-list-failed" }
    | { type: "diagrams-found"; seq: number; hits: DiagramHit[] }
    | { type: "spinner-delay-elapsed" }
    | { type: "diagram-picked"; hit: DiagramHit }
    | { type: "went-to-diagram" }
    | { type: "diagram-renamed" };

  export type Effect =
    | { type: "run-root-command"; command: RootCommand }
    | { type: "insert-icon"; name: string }
    | { type: "record-icon-use"; name: string }
    | { type: "replace-icon"; shapeId: CvmIconShape["id"]; name: string }
    | { type: "save-component"; name: string }
    | { type: "insert-component"; componentId: string }
    | { type: "rename-component"; componentId: string; name: string }
    | { type: "delete-component"; componentId: string }
    | { type: "list-components" }
    /** Waits `delayMs`, then searches; stopping it during the wait cancels it. */
    | { type: "search-diagrams"; query: string; seq: number; delayMs: number }
    | { type: "wait-for-spinner"; delayMs: number }
    | { type: "go-to-diagram"; target: DiagramTarget }
    | { type: "rename-diagram"; name: string }
    | { type: "report-error"; message: string }
    | { type: "report-success" };
}

type State = paletteReducer.State;
type Action = paletteReducer.Action;
type Effect = paletteReducer.Effect;
type Exec = EffectReducerExec<State, Action, Effect>;

export const createInitialPaletteState = (): State => ({
  open: false,
  nav: INITIAL_NAV,
  hasSelection: false,
  selectedIcon: null,
  recentIcons: [],
  components: [],
  componentUnderEdit: null,
  diagramHits: [],
  searching: false,
  searchSeq: 0,
  search: null,
  working: false,
  busy: false,
  spinnerDelay: null,
});

export function currentPage(nav: PaletteNav): PageKey {
  return nav.stack[nav.stack.length - 1] ?? "root";
}

export const selectPage = (state: State) => currentPage(state.nav);

export const selectRootActions = (state: State) =>
  visibleRootActions({
    hasSelection: state.hasSelection,
    hasSingleIcon: !!state.selectedIcon,
  });

/** Client-side filtering PRESERVES the server's recency ordering. */
export const selectComponents = (state: State) =>
  state.components.filter((c) => matchesComponentName(c.name, state.nav.query));

const ROOT_COMMANDS: readonly string[] = [
  "preserve-snapshot",
  "restore-head",
  "copy-contents",
  "new-diagram",
  "recentre-diagram",
] satisfies RootCommand[];

const INSERT_FAILED: Record<
  Extract<Action, { type: "component-insert-failed" }>["reason"],
  string
> = {
  gone: "That component no longer exists",
  "request-failed": "Couldn't insert component",
  incompatible: "This component was saved with an incompatible tldraw version",
};

const SAVE_FAILED: Record<
  Extract<Action, { type: "component-save-failed" }>["reason"],
  string | null
> = {
  // The save is simply not made: there is nothing to say about it.
  "nothing-selected": null,
  "capture-failed": "Couldn't capture that selection",
  "request-failed": "Couldn't save that component",
};

/** One level back, clearing the query and the highlight on the way. */
const popped = (nav: PaletteNav): PaletteNav => ({
  stack: nav.stack.slice(0, -1),
  query: "",
  value: "",
});

/**
 * push/pop clear BOTH the query and the highlighted value — a query left over
 * from the previous page would silently filter the new one.
 */
const pushed = (nav: PaletteNav, page: PageKey): PaletteNav => ({
  stack: [...nav.stack, page],
  query: "",
  value: "",
});

const closed = (state: State): State => ({ ...state, open: false });

/** Whatever `working` was, it is over: the spinner goes with it. */
const doneWorking = (state: State, exec: Exec): State => {
  if (state.spinnerDelay) exec.stop(state.spinnerDelay);
  return { ...state, working: false, busy: false, spinnerDelay: null };
};

const startWorking = (state: State, exec: Exec, effect: Effect): State => {
  exec(effect);
  return {
    ...state,
    working: true,
    spinnerDelay: exec({
      type: "wait-for-spinner",
      delayMs: SPINNER_THRESHOLD_MS,
    }),
  };
};

/**
 * The page-entry rules, applied after every transition: the diagrams page
 * searches whenever it is entered or its query changes, and the components
 * page lists the library whenever it is entered while open.
 */
const followPage = (prev: State, next: State, exec: Exec): State => {
  const prevPage = currentPage(prev.nav);
  const page = currentPage(next.nav);
  let state = next;

  if (
    page === "components" &&
    next.open &&
    (prevPage !== "components" || !prev.open)
  ) {
    exec({ type: "list-components" });
  }

  if (page === "diagrams") {
    if (prevPage !== "diagrams" || prev.nav.query !== next.nav.query) {
      // An empty query is a REQUEST, not a skip: the route answers it with the
      // most recently touched diagrams, so the page opens on something
      // jumpable. It goes out at once — the debounce spares the server a query
      // per keystroke, and there are no keystrokes here.
      const query = next.nav.query.trim();
      const seq = state.searchSeq + 1;
      state = {
        ...state,
        searchSeq: seq,
        searching: true,
        search: exec.replace(state.search ?? undefined, {
          type: "search-diagrams",
          query,
          seq,
          delayMs: query ? SEARCH_DEBOUNCE_MS : 0,
        }),
      };
    }
  } else if (prevPage === "diagrams" && state.search) {
    // Leaving the page cancels a search still waiting out its debounce.
    exec.stop(state.search);
    state = { ...state, search: null };
  }

  return state;
};

type Handlers = {
  [K in Action["type"]]: (
    state: State,
    action: Extract<Action, { type: K }>,
    exec: Exec
  ) => State;
};

const on: Handlers = {
  "palette-summoned": (state, action, exec) => {
    // Reset on every summon, so the palette behaves the same way every time
    // regardless of what the last session did. A summon onto a page (Ctrl+F
    // → diagram search) stacks it ON the reset root, so Esc backs out to the
    // full command list exactly as it would have had the row been picked.
    const nav = action.page ? pushed(INITIAL_NAV, action.page) : INITIAL_NAV;
    if (state.spinnerDelay) exec.stop(state.spinnerDelay);
    return {
      ...state,
      open: true,
      nav,
      hasSelection: action.hasSelection,
      selectedIcon: action.selectedIcon,
      recentIcons: action.recentIcons,
      busy: false,
      spinnerDelay: null,
    };
  },
  "palette-dismissed": (state) => closed(state),
  "escape-pressed": (state) => {
    // Esc backs out one level at a time, so a mis-typed query on the icon
    // page doesn't throw you all the way out. At the root it closes.
    if (state.nav.stack.length <= 1) return closed(state);
    return { ...state, nav: popped(state.nav) };
  },
  "backspace-pressed": (state) => {
    // "Undo my way out" without reaching for Esc — but only once the query
    // is already empty, so backspacing through a query still works. Known
    // side effect: clearing a nested page's query with backspaces then
    // kicks you back to the parent. It never closes the palette.
    if (state.nav.query !== "" || state.nav.stack.length <= 1) return state;
    return { ...state, nav: popped(state.nav) };
  },
  "query-typed": (state, action) => ({
    ...state,
    nav: { ...state.nav, query: action.query },
  }),
  "highlight-moved": (state, action) => ({
    ...state,
    nav: { ...state.nav, value: action.value },
  }),
  "root-action-picked": (state, action, exec) => {
    const { action: row } = action;
    if (row.opens) return { ...state, nav: pushed(state.nav, row.opens) };
    if (ROOT_COMMANDS.includes(row.id)) {
      exec({ type: "run-root-command", command: row.id as RootCommand });
    }
    return closed(state);
  },
  "icon-picked": (state, action, exec) => {
    exec({ type: "insert-icon", name: action.name });
    return state;
  },
  "icon-inserted": (state, action, exec) => {
    // The palette goes when the shapes LAND. At the page's shape cap
    // nothing lands, and the `max-shapes` error is the only thing the
    // author should see. Only an icon that landed is recorded, so a run
    // into the cap does not reorder the grid.
    if (!action.landed) return state;
    exec({ type: "record-icon-use", name: action.name });
    return closed(state);
  },
  "replacement-icon-picked": (state, action, exec) => {
    if (!state.selectedIcon) return state;
    exec({
      type: "replace-icon",
      shapeId: state.selectedIcon.id,
      name: action.name,
    });
    return state;
  },
  "icon-replaced": (state) => closed(state),
  "icon-replace-failed": (state, _action, exec) => {
    // The palette stays up when the canvas did not change, rather than
    // vanishing on a keypress that did nothing.
    exec({
      type: "report-error",
      message: "That icon is no longer on the canvas",
    });
    return state;
  },
  "name-submitted": (state, action, exec) => {
    const name = action.name.trim();
    // An empty name BLOCKS it: a component is only findable by name, so an
    // "Untitled 3" is dead weight. No auto-naming.
    if (!name) return state;
    const page = currentPage(state.nav);
    if (page === "nameComponent") {
      if (state.working) return state;
      return startWorking(state, exec, { type: "save-component", name });
    }
    if (page === "renameComponent" && state.componentUnderEdit) {
      exec({
        type: "rename-component",
        componentId: state.componentUnderEdit.id,
        name,
      });
    }
    if (page === "renameDiagram") exec({ type: "rename-diagram", name });
    return state;
  },
  "component-saved": (state, _action, exec) => {
    exec({ type: "report-success" });
    return closed(doneWorking(state, exec));
  },
  "component-save-failed": (state, action, exec) => {
    const message = SAVE_FAILED[action.reason];
    if (message) exec({ type: "report-error", message });
    return doneWorking(state, exec);
  },
  "component-picked": (state, action, exec) => {
    if (state.working) return state;
    return startWorking(state, exec, {
      type: "insert-component",
      componentId: action.component.id,
    });
  },
  "component-inserted": (state, action, exec) => {
    // The palette closes when the shapes LAND, never before — so at the
    // page's shape cap it stays up and retrying is one Enter.
    if (!action.landed) return doneWorking(state, exec);
    exec({ type: "report-success" });
    return closed(doneWorking(state, exec));
  },
  "component-insert-failed": (state, action, exec) => {
    exec({ type: "report-error", message: INSERT_FAILED[action.reason] });
    const next = doneWorking(state, exec);
    if (action.reason !== "gone") return next;
    // Reachable, because delete is a hard DELETE: another window may have
    // removed it. Drop the tile so the library heals itself instead of
    // offering something that can never work.
    return {
      ...next,
      components: next.components.filter((c) => c.id !== action.componentId),
    };
  },
  "rename-component-clicked": (state, action) => ({
    ...state,
    componentUnderEdit: action.component,
    nav: pushed(state.nav, "renameComponent"),
  }),
  "component-renamed": (state, action, exec) => {
    // Back on the library, showing the new name at once; the list it
    // re-reads on the way in brings the server's order.
    exec({ type: "report-success" });
    return {
      ...state,
      nav:
        currentPage(state.nav) === "renameComponent"
          ? popped(state.nav)
          : state.nav,
      components: state.components.map((c) =>
        c.id === action.componentId ? { ...c, name: action.name } : c
      ),
    };
  },
  "component-rename-failed": (state, _action, exec) => {
    exec({
      type: "report-error",
      message: "Couldn't rename that component",
    });
    return state;
  },
  "delete-component-clicked": (state, action, exec) => {
    exec({ type: "delete-component", componentId: action.componentId });
    return state;
  },
  "component-deleted": (state, action, exec) => {
    exec({ type: "report-success" });
    return {
      ...state,
      components: state.components.filter((c) => c.id !== action.componentId),
    };
  },
  "component-delete-failed": (state, _action, exec) => {
    exec({
      type: "report-error",
      message: "Couldn't delete that component",
    });
    return state;
  },
  "components-listed": (state, action) => ({
    ...state,
    components: action.components,
  }),
  "components-list-failed": (state) => {
    // A failed list leaves the previous one up; the palette is still usable.
    return state;
  },
  "diagrams-found": (state, action) => {
    // A slow early response cannot overwrite a fast later one.
    if (action.seq !== state.searchSeq) return state;
    return {
      ...state,
      diagramHits: action.hits,
      searching: false,
      search: null,
    };
  },
  "spinner-delay-elapsed": (state) => {
    if (!state.working) return state;
    return { ...state, busy: true, spinnerDelay: null };
  },
  "diagram-picked": (state, action, exec) => {
    // The WHOLE hit goes through, not just the id: picking a snapshot means
    // "take me to that state", exactly as it does from the search box on
    // Playground Home.
    exec({ type: "go-to-diagram", target: action.hit });
    return state;
  },
  "went-to-diagram": (state) => closed(state),
  "diagram-renamed": (state) => closed(state),
};

/** Each event's handler, looked up by its type. */
const decide = (state: State, action: Action, exec: Exec): State =>
  (on[action.type] as (s: State, a: Action, e: Exec) => State)(
    state,
    action,
    exec
  );

export const paletteReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => followPage(state, decide(state, action, exec), exec);
