import type {
  EffectEntity,
  EffectReducer,
  EffectReducerExec,
} from "use-effect-reducer";
import type { SearchHit } from "@cvm/core/services/db-search-operations.server";
import { entityPath } from "@/features/entity-links/entity-deep-link";
import { globalSearchRows, hitEntity } from "./global-search-selectors";

/**
 * Global Search: the main app's Ctrl/Cmd+K dialog that finds any non-archived
 * Course, Section, Lesson, Video or Pitch, in each Course's Draft Version, and
 * opens it. See docs/FRONTEND_STATE.md.
 */
export namespace globalSearchReducer {
  /** What Global Search searches: every kind but Beats. */
  export type Hit = Exclude<SearchHit, { kind: "beat" }>;

  export interface State {
    open: boolean;
    query: string;
    /**
     * `searching` from the keystroke until the current query's results come
     * back (the runner's debounce included); the last results stay shown.
     */
    status: "idle" | "searching" | "done" | "failed";
    /** The current query's hits, in the search's own order. */
    hits: Hit[];
    /** Index into `globalSearchRows(state)`. */
    highlighted: number;
    /** The pending search, so the next keystroke or a close cancels it. */
    search: EffectEntity<State, Action> | null;
  }

  export type Action =
    | { type: "shortcut-pressed" }
    | { type: "search-button-clicked" }
    /** Escape, a click outside, or the close button. */
    | { type: "dismissed" }
    | { type: "query-typed"; query: string }
    | { type: "results-arrived"; query: string; hits: Hit[] }
    | { type: "search-failed"; query: string }
    | { type: "arrow-pressed"; direction: "up" | "down" }
    /** Enter on the highlighted row, or a click on a row. */
    | { type: "result-picked"; index: number };

  export type Effect =
    /** Wait out the debounce, then search. Replaced by the next keystroke. */
    { type: "search"; query: string } | { type: "navigate"; path: string };
}

type State = globalSearchReducer.State;

export const createInitialGlobalSearchState = (): State => ({
  open: false,
  query: "",
  status: "idle",
  hits: [],
  highlighted: 0,
  search: null,
});

type Exec = EffectReducerExec<
  globalSearchReducer.State,
  globalSearchReducer.Action,
  globalSearchReducer.Effect
>;

const opened = (): State => ({
  ...createInitialGlobalSearchState(),
  open: true,
});

/** Closing cancels a search still waiting or in flight. */
const closed = (state: State, exec: Exec): State => {
  if (state.search) exec.stop(state.search);
  return createInitialGlobalSearchState();
};

const typed = (state: State, query: string, exec: Exec): State => {
  if (query.trim() === "") {
    if (state.search) exec.stop(state.search);
    return { ...opened(), query };
  }
  return {
    ...state,
    query,
    status: "searching",
    search: exec.replace(state.search ?? undefined, { type: "search", query }),
  };
};

/** The search for the current query answered; a late answer is ignored. */
const answered = (
  state: State,
  query: string,
  outcome: { status: "done" | "failed"; hits: globalSearchReducer.Hit[] }
): State =>
  !state.open || query !== state.query
    ? state
    : { ...state, ...outcome, highlighted: 0, search: null };

const moved = (state: State, direction: "up" | "down"): State => {
  const last = globalSearchRows(state).length - 1;
  const step = direction === "down" ? 1 : -1;
  const highlighted = Math.min(last, Math.max(0, state.highlighted + step));
  return last < 0 || highlighted === state.highlighted
    ? state
    : { ...state, highlighted };
};

const picked = (state: State, index: number, exec: Exec): State => {
  const row = globalSearchRows(state)[index];
  if (!state.open || !row) return state;
  exec({ type: "navigate", path: entityPath(hitEntity(row.hit)) });
  return closed(state, exec);
};

export const globalSearchReducer: EffectReducer<
  globalSearchReducer.State,
  globalSearchReducer.Action,
  globalSearchReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "shortcut-pressed":
      // The summon key is the dismiss key too.
      return state.open ? closed(state, exec) : opened();
    case "search-button-clicked":
      return state.open ? state : opened();
    case "dismissed":
      return state.open ? closed(state, exec) : state;
    case "query-typed":
      return state.open ? typed(state, action.query, exec) : state;
    case "results-arrived":
      return answered(state, action.query, {
        status: "done",
        hits: action.hits,
      });
    case "search-failed":
      return answered(state, action.query, { status: "failed", hits: [] });
    case "arrow-pressed":
      return moved(state, action.direction);
    case "result-picked":
      return picked(state, action.index, exec);
  }
};
