// PROTOTYPE — throwaway. Shared state for all three palette variants.
// Layout is what the variants disagree about; this state model is common.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "tldraw";
import {
  ACTIONS_BY_ID,
  ROOT_ACTIONS,
  STUB_COMPONENTS,
  filterIcons,
  ICON_INDEX,
  type PageKey,
  type RootAction,
} from "./palette-model";

export type DiagramHit = {
  diagramId: string;
  snapshotId: string | null;
  diagramName: string;
  contentHash: string | null;
  searchText: string | null;
  source: string;
};

/**
 * Grid pages are the ones that need custom 2-D navigation. Diagrams joined
 * this list once its results became thumbnail cards laid out like the
 * diagrams root page — a text list would not have needed it.
 */
export const GRID_PAGES: PageKey[] = ["icons", "components", "diagrams"];

export type PaletteState = ReturnType<typeof usePaletteState>;

export function usePaletteState(opts: {
  editorRef: React.RefObject<Editor | null>;
  /** Flip icons between manual filtering and cmdk's own filter over all 1,611. */
  iconFilterMode: "manual" | "cmdk";
  iconCap: number;
}) {
  const { editorRef, iconFilterMode, iconCap } = opts;

  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<PageKey[]>(["root"]);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);

  const page = stack[stack.length - 1] ?? "root";

  const record = useCallback((line: string) => {
    setLog((l) =>
      [`${new Date().toLocaleTimeString()} — ${line}`, ...l].slice(0, 8)
    );
  }, []);

  // --- Cmd+K --------------------------------------------------------------
  // tldraw 5.2.4 leaves Cmd+K unbound (laser tool binds bare `k`, and its
  // modifier matching is exact) and never stopPropagations keydown, so a
  // plain document listener is enough.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reset the stack every time the palette opens.
  useEffect(() => {
    if (open) {
      setStack(["root"]);
      setQuery("");
      setValue("");
      setHasSelection(
        (editorRef.current?.getSelectedShapeIds().length ?? 0) > 0
      );
    }
  }, [open, editorRef]);

  const push = useCallback((next: PageKey) => {
    setStack((s) => [...s, next]);
    setQuery("");
    setValue("");
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    setQuery("");
    setValue("");
  }, []);

  /**
   * Escape / Backspace page-stack handling, mounted on <Command onKeyDown>.
   * Runs before cmdk's own handler (cmdk bails on e.defaultPrevented).
   *
   * GOTCHA, found the hard way: stopPropagation here does NOT save you from
   * Radix. DismissableLayer binds its Escape handler on `document` with
   * { capture: true }, so it has already dismissed the dialog before this
   * bubble-phase React handler ever runs — Esc would pop a page AND close the
   * palette in the same keystroke. The only fix is `onEscapeKeyDown` on
   * DialogContent (see `blockRadixEscape` below), which Radix calls first and
   * which respects preventDefault. Non-modal variants don't have this problem.
   */
  const onStackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        if (stack.length > 1) {
          e.preventDefault();
          pop();
        }
        // At root: let it through — Radix closes the dialog.
        return;
      }
      if (e.key === "Backspace" && query === "" && stack.length > 1) {
        e.preventDefault();
        pop();
      }
    },
    [stack.length, query, pop]
  );

  /**
   * For the Radix-hosted variants: stop Radix dismissing the dialog when
   * Escape should only pop a page. Radix runs this first, in capture phase.
   */
  const blockRadixEscape = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (stack.length > 1) e.preventDefault();
    },
    [stack.length]
  );

  // --- Root actions -------------------------------------------------------
  const rootActions = useMemo(
    () => ROOT_ACTIONS.filter((a) => !a.requiresSelection || hasSelection),
    [hasSelection]
  );

  const runAction = useCallback(
    (action: RootAction) => {
      if (action.opens) {
        push(action.opens);
        return;
      }
      record(`fired action: ${action.label}`);
      setOpen(false);
    },
    [push, record]
  );

  const selectById = useCallback(
    (id: string) => {
      const action = ACTIONS_BY_ID.get(id);
      if (action) runAction(action);
    },
    [runAction]
  );

  // --- Icons --------------------------------------------------------------
  const icons = useMemo(() => {
    if (iconFilterMode === "cmdk") return ICON_INDEX; // cmdk filters all 1,611
    return filterIcons(query, iconCap);
  }, [query, iconFilterMode, iconCap]);

  const insertIcon = useCallback(
    (name: string) => {
      record(`insert icon "${name}" at viewport centre`);
      setOpen(false);
    },
    [record]
  );

  /**
   * Who does the filtering, per page.
   *  - diagrams: always the server (locked decision 16)
   *  - icons: manual by default; flip to cmdk to feel 1,611 mounted cells
   *  - components / root: cmdk's own filter
   */
  const shouldFilter =
    page === "diagrams"
      ? false
      : page === "icons"
        ? iconFilterMode === "cmdk"
        : true;

  // --- Components ---------------------------------------------------------
  // Small set: left to cmdk's own filter, which exercises the [hidden] group
  // behaviour that a grid layout has to survive.
  const components = STUB_COMPONENTS;

  const insertComponent = useCallback(
    (name: string) => {
      record(`insert component "${name}" at viewport centre`);
      setOpen(false);
    },
    [record]
  );

  const saveComponent = useCallback(
    (name: string) => {
      record(`save selection as component "${name || "(unnamed)"}"`);
      setOpen(false);
    },
    [record]
  );

  // --- Diagrams (server-side, shouldFilter={false}) ------------------------
  const [diagramHits, setDiagramHits] = useState<DiagramHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (page !== "diagrams") return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setDiagramHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/palette-prototype-search?q=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        if (seq === searchSeq.current) setDiagramHits(data.results ?? []);
      } catch {
        if (seq === searchSeq.current) setDiagramHits([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, page]);

  const goToDiagram = useCallback(
    (hit: DiagramHit) => {
      record(`navigate to diagram "${hit.diagramName}" (${hit.source})`);
      setOpen(false);
    },
    [record]
  );

  return {
    open,
    setOpen,
    stack,
    page,
    push,
    pop,
    query,
    setQuery,
    value,
    setValue,
    onStackKeyDown,
    shouldFilter,
    blockRadixEscape,
    hasSelection,
    setHasSelection,
    rootActions,
    runAction,
    selectById,
    icons,
    insertIcon,
    components,
    insertComponent,
    saveComponent,
    diagramHits,
    searching,
    goToDiagram,
    log,
  };
}

export const PAGE_TITLES: Record<PageKey, string> = {
  root: "Command palette",
  icons: "Insert icon",
  diagrams: "Go to diagram",
  components: "Insert component",
  nameComponent: "Save selection as component",
};
