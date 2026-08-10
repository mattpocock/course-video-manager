import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { Editor } from "tldraw";
import { searchIconNames } from "@/packages/lucide-icons";
import { renderThumbnailPngBase64 } from "@/features/diagrams/render-thumbnail";
import {
  buildIconContent,
  insertContentAtViewportCentre,
  quantiseIconSize,
} from "@/features/diagrams/insert-onto-canvas";
import {
  replaceIconName,
  singleSelectedIcon,
} from "@/features/diagrams/replace-icon";
import type { CvmIconShape } from "@/features/diagrams/cvm-icon-shape";
import {
  ICON_RESULT_CAP,
  matchesComponentName,
  visibleRootActions,
  type RootAction,
} from "./palette-model";
import { readRecentIcons, recordIconUse } from "./recent-icons";
import {
  INITIAL_NAV,
  currentPage,
  navReducer,
  type NavAction,
  type PageKey,
  type PaletteNav,
} from "./palette-nav";
import { paletteKeyCommand } from "./palette-shortcuts";

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

export type PaletteHandlers = {
  onPreserveSnapshot: () => void | Promise<void>;
  onRestoreToHead: () => void | Promise<void>;
  onCopyContents: () => void | Promise<void>;
  onRenameDiagram: (name: string) => void | Promise<void>;
  onNewDiagram: () => void | Promise<void>;
  /**
   * Navigating away flushes the pending save first — see the call site. A
   * snapshot hit is restored on the way, so the author arrives at the state
   * they picked out of the results.
   */
  onGoToDiagram: (target: DiagramTarget) => void | Promise<void>;
};

/** Server-side diagram search is debounced by this much. */
const SEARCH_DEBOUNCE_MS = 180;

/** No spinner below this, where it would only flicker. */
const SPINNER_THRESHOLD_MS = 150;

export function usePalette(opts: {
  editorRef: React.RefObject<Editor | null>;
  handlers: PaletteHandlers;
}) {
  const { editorRef, handlers } = opts;

  const [open, setOpen] = useState(false);
  const [nav, dispatchNav] = useReducer(
    (state: PaletteNav, action: NavAction) => navReducer(state, action).nav,
    INITIAL_NAV
  );
  const page = currentPage(nav);

  const [hasSelection, setHasSelection] = useState(false);
  /** The lone selected icon, if the selection is exactly that. */
  const [selectedIcon, setSelectedIcon] = useState<CvmIconShape | null>(null);
  const [busy, setBusy] = useState(false);

  /** Esc / Backspace, routed through the reducer so closing stays its decision. */
  const navigateBack = useCallback(
    (action: Extract<NavAction, { type: "escape" | "backspace" }>) => {
      const result = navReducer(nav, action);
      dispatchNav(action);
      if (result.close) setOpen(false);
    },
    [nav]
  );

  /**
   * Every summon runs through here, `page` and all — a call, not a piece of
   * state reconciled by an effect. That distinction is the whole point: an
   * effect keyed on "which page was asked for" does nothing at all when the
   * answer has not changed, so Cmd+F pressed a second time (opened onto the
   * search, Esc back to the root, Cmd+F again) would be a dead keypress.
   */
  const openPalette = useCallback(
    (page: PageKey | null) => {
      dispatchNav(page ? { type: "openAt", page } : { type: "open" });
      setBusy(false);
      // Read on every summon: the palette is modal, so the canvas cannot change
      // underneath it, and every page below decides what it offers from this.
      const selected = editorRef.current?.getSelectedShapes() ?? [];
      setHasSelection(selected.length > 0);
      setSelectedIcon(singleSelectedIcon(selected));
      setOpen(true);
    },
    [editorRef]
  );

  /** Radix's handle on the dialog: a click away comes back through here. */
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) openPalette(null);
      else setOpen(false);
    },
    [openPalette]
  );

  // --- Shortcuts -----------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const command = paletteKeyCommand(e, { isOpen: open });
      if (!command) return;
      e.preventDefault();
      if (command.command === "close") setOpen(false);
      else openPalette(command.page);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette]);

  // At `maxShapesPerPage`, `putContentOntoCurrentPage` bails SILENTLY — it
  // emits this event and returns. Without listening, an insert at the cap looks
  // like a dead keypress.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onMaxShapes = () =>
      toast.error("This page is full — tldraw's shape limit was reached");
    editor.on("max-shapes", onMaxShapes);
    return () => {
      editor.off("max-shapes", onMaxShapes);
    };
  }, [editorRef, open]);

  // --- Root ----------------------------------------------------------------
  const rootActions = useMemo(
    () => visibleRootActions({ hasSelection, hasSingleIcon: !!selectedIcon }),
    [hasSelection, selectedIcon]
  );

  const runAction = useCallback(
    (action: RootAction) => {
      if (action.opens) {
        dispatchNav({ type: "push", page: action.opens });
        return;
      }
      switch (action.id) {
        case "preserve-snapshot":
          void handlers.onPreserveSnapshot();
          break;
        case "restore-head":
          void handlers.onRestoreToHead();
          break;
        case "copy-contents":
          void handlers.onCopyContents();
          break;
        case "new-diagram":
          void handlers.onNewDiagram();
          break;
      }
      setOpen(false);
    },
    [handlers]
  );

  // --- Icons ---------------------------------------------------------------
  // Re-read on every open, not once at mount: storage is the source of truth
  // (see `recent-icons`), and this is only the copy the grid renders from.
  const [recentIcons, setRecentIcons] = useState<string[]>([]);
  useEffect(() => {
    if (open) setRecentIcons(readRecentIcons());
  }, [open]);

  const icons = useMemo(
    () =>
      searchIconNames(nav.query, {
        limit: ICON_RESULT_CAP,
        recent: recentIcons,
      }),
    [nav.query, recentIcons]
  );

  const insertIcon = useCallback(
    (name: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      // Sizing is the one thing the insert path actively supplies: it is the
      // only place that can see the camera zoom.
      const content = buildIconContent({
        name,
        size: quantiseIconSize(editor.getZoomLevel()),
        schema: editor.store.schema.serialize(),
      });

      const landed = insertContentAtViewportCentre(editor, content, {
        historyLabel: "insert icon",
      });
      // Synchronous, so it closes instantly — by the same rule the async
      // component path follows: the palette goes when the shapes LAND. At the
      // page's shape cap nothing lands, and the `max-shapes` toast below is the
      // only thing the author should see.
      if (!landed) return;
      // Recorded only for an icon that actually landed, so a run into the shape
      // cap does not reorder the grid for an insert that never happened. The
      // palette is closing, so the reorder is never seen mid-gesture.
      setRecentIcons(recordIconUse(name));
      setOpen(false);
    },
    [editorRef]
  );

  const replaceIcon = useCallback(
    (name: string) => {
      const editor = editorRef.current;
      if (!editor || !selectedIcon) return;

      // No size, no point, no camera: the shape already has all of that, and
      // keeping it is the entire reason this is not an insert.
      if (!replaceIconName(editor, selectedIcon.id, name)) {
        // Same rule as the insert paths — the palette stays up when the canvas
        // did not change, rather than vanishing on a keypress that did nothing.
        toast.error("That icon is no longer on the canvas");
        return;
      }
      setOpen(false);
    },
    [editorRef, selectedIcon]
  );

  // --- Components ----------------------------------------------------------
  const [components, setComponents] = useState<ComponentSummary[]>([]);

  const refreshComponents = useCallback(async () => {
    try {
      const res = await fetch("/api/diagram-components/list");
      if (!res.ok) return;
      const data = await res.json();
      setComponents(data.components ?? []);
    } catch {
      // A failed list leaves the previous one up; the palette is still usable.
    }
  }, []);

  useEffect(() => {
    if (open && page === "components") void refreshComponents();
  }, [open, page, refreshComponents]);

  /** Client-side filtering PRESERVES the server's recency ordering. */
  const filteredComponents = useMemo(
    () => components.filter((c) => matchesComponentName(c.name, nav.query)),
    [components, nav.query]
  );

  /** Run an async step, showing a spinner only if it is genuinely slow. */
  const withSpinner = useCallback(async <T>(fn: () => Promise<T>) => {
    const timer = setTimeout(() => setBusy(true), SPINNER_THRESHOLD_MS);
    try {
      return await fn();
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }, []);

  const saveComponent = useCallback(
    async (name: string) => {
      const editor = editorRef.current;
      // An empty name BLOCKS the save: a component is only findable by name, so
      // an "Untitled 3" is dead weight. No auto-naming.
      if (!editor || !name.trim()) return;

      const shapeIds = editor.getSelectedShapeIds();
      if (shapeIds.length === 0) return;

      await withSpinner(async () => {
        try {
          // tldraw already solves the hard part: this expands the selection to
          // descendants (so group and frame children come along), keeps only
          // bindings with BOTH ends inside the selection, drops dangling ones,
          // and rewrites root shapes into page coordinates.
          const content = editor.getContentFromCurrentPage(shapeIds);
          if (!content) {
            toast.error("Couldn't capture that selection");
            return;
          }
          // `users` is collaborator presence — meaningless here, and the
          // clipboard envelope is a transport concern that is not persisted.
          const { users: _users, ...sceneFragment } = content;

          const thumbnailPngBase64 = await renderThumbnailPngBase64(
            editor,
            shapeIds
          );

          const res = await fetch("/api/diagram-components/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              sceneFragment,
              thumbnailPngBase64,
            }),
          });
          if (!res.ok) {
            toast.error("Couldn't save that component");
            return;
          }
          toast.success(`Saved “${name.trim()}”`);
          setOpen(false);
        } catch {
          toast.error("Couldn't save that component");
        }
      });
    },
    [editorRef, withSpinner]
  );

  const insertComponent = useCallback(
    async (component: ComponentSummary) => {
      const editor = editorRef.current;
      if (!editor) return;

      await withSpinner(async () => {
        let fragment: unknown;
        try {
          const res = await fetch(
            `/api/diagram-components/${component.id}/insert`,
            { method: "POST" }
          );
          if (res.status === 404) {
            // Reachable, because delete is a hard DELETE: another window may
            // have removed it. Drop the tile so the library heals itself
            // instead of offering something that can never work.
            toast.error("That component no longer exists");
            setComponents((cs) => cs.filter((c) => c.id !== component.id));
            return;
          }
          if (!res.ok) {
            toast.error("Couldn't insert component");
            return;
          }
          fragment = (await res.json()).sceneFragment;
        } catch {
          // A network blip leaves the palette open, so retrying is one Enter.
          toast.error("Couldn't insert component");
          return;
        }

        let landed: boolean;
        try {
          landed = insertContentAtViewportCentre(editor, fragment as never, {
            historyLabel: "insert component",
          });
        } catch (error) {
          // `putContentOntoCurrentPage` runs the store's migrations against the
          // stored schema and throws when it cannot migrate. The row is left
          // untouched: no broken flag, no migration-on-read backfill.
          //
          // Logged as well as toasted: the toast names the likeliest cause, but
          // any throw out of the put lands here, so the real one has to stay
          // reachable from the console.
          console.error("Component insert failed", error);
          toast.error(
            "This component was saved with an incompatible tldraw version"
          );
          return;
        }
        // The palette closes when the shapes LAND, never before — so at the
        // page's shape cap it stays up and retrying is one Enter.
        if (landed) setOpen(false);
      });
    },
    [editorRef, withSpinner]
  );

  const [componentUnderEdit, setComponentUnderEdit] =
    useState<ComponentSummary | null>(null);

  const renameComponent = useCallback(
    async (id: string, name: string) => {
      if (!name.trim()) return;
      const body = new FormData();
      body.set("name", name.trim());
      const res = await fetch(`/api/diagram-components/${id}/rename`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        toast.error("Couldn't rename that component");
        return;
      }
      await refreshComponents();
      dispatchNav({ type: "pop" });
    },
    [refreshComponents]
  );

  const deleteComponent = useCallback(async (id: string) => {
    const res = await fetch(`/api/diagram-components/${id}/delete`, {
      method: "POST",
    });
    if (!res.ok) {
      toast.error("Couldn't delete that component");
      return;
    }
    setComponents((cs) => cs.filter((c) => c.id !== id));
  }, []);

  // --- Diagrams (server-side search) ---------------------------------------
  const [diagramHits, setDiagramHits] = useState<DiagramHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (page !== "diagrams") return;
    const q = nav.query.trim();
    // A sequence guard, so a slow early response cannot overwrite a fast later
    // one.
    const seq = ++searchSeq.current;
    setSearching(true);
    // An empty query is a REQUEST, not a skip: the route answers it with the
    // most recently touched diagrams, so the page opens on something jumpable.
    // It goes out immediately — the debounce exists to spare the server a query
    // per keystroke, and there are no keystrokes here.
    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(
            `/api/diagrams/search?q=${encodeURIComponent(q)}`
          );
          const data = await res.json();
          if (seq === searchSeq.current) setDiagramHits(data.results ?? []);
        } catch {
          if (seq === searchSeq.current) setDiagramHits([]);
        } finally {
          if (seq === searchSeq.current) setSearching(false);
        }
      },
      q ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [nav.query, page]);

  const goToDiagram = useCallback(
    async (hit: DiagramHit) => {
      // The WHOLE hit goes through, not just the id: picking a snapshot means
      // "take me to that state", exactly as it does from the search box on
      // Playground Home. Discarding the snapshot id here landed the author on
      // the diagram's head instead — the one state they did not choose.
      await handlers.onGoToDiagram(hit);
      setOpen(false);
    },
    [handlers]
  );

  const renameDiagram = useCallback(
    async (name: string) => {
      if (!name.trim()) return;
      await handlers.onRenameDiagram(name.trim());
      setOpen(false);
    },
    [handlers]
  );

  return {
    open,
    onOpenChange,
    nav,
    page,
    dispatch: dispatchNav,
    navigateBack,
    busy,
    hasSelection,
    rootActions,
    runAction,
    icons,
    insertIcon,
    selectedIcon,
    replaceIcon,
    components: filteredComponents,
    insertComponent,
    saveComponent,
    componentUnderEdit,
    setComponentUnderEdit,
    renameComponent,
    deleteComponent,
    diagramHits,
    searching,
    goToDiagram,
    renameDiagram,
  };
}

export type PaletteState = ReturnType<typeof usePalette>;
export type { PageKey };
