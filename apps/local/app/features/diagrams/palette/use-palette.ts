import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { usePlaygroundStatus } from "@/features/diagrams/playground-status";
import type { Editor } from "tldraw";
import { searchIconNames } from "@/packages/lucide-icons";
import { renderThumbnailPngBase64 } from "@/features/diagrams/render-thumbnail";
import {
  buildIconContent,
  buildSceneContent,
  insertContentAtViewportCentre,
  insertDrawingAsGroup,
  quantiseIconSize,
} from "@/features/diagrams/insert-onto-canvas";
import {
  replaceIconName,
  singleSelectedIcon,
} from "@/features/diagrams/replace-icon";
import { ICON_RESULT_CAP } from "./palette-model";
import { readRecentIcons, recordIconUse } from "./recent-icons";
import {
  createInitialPaletteState,
  paletteReducer,
  selectComponents,
  selectPage,
  selectRootActions,
  type DiagramInsertTarget,
  type DiagramTarget,
  type PageKey,
} from "./palette-reducer";
import { paletteKeyCommand } from "./palette-shortcuts";
import type { ThumbnailDiagramSource } from "@cvm/core/lib/thumbnail-diagram-sources";

export type {
  ComponentSummary,
  DiagramHit,
  DiagramTarget,
} from "./palette-reducer";

/**
 * The actions on the Diagram the editor edits. Only the playground has one:
 * the thumbnail editor edits a Thumbnail Diagram (ADR 0060), and the palette
 * leaves these rows out there.
 */
export type DiagramPaletteHandlers = {
  onPreserveSnapshot: () => void | Promise<void>;
  onRestoreToHead: () => void | Promise<void>;
  onCopyContents: () => void | Promise<void>;
  onRenameDiagram: (name: string) => void | Promise<void>;
  onNewDiagram: () => void | Promise<void>;
  /** The same camera move the manual Cmd/Ctrl+0 shortcut runs. */
  onRecentreDiagram: () => void;
};

export type PaletteHandlers = {
  /** Null in an editor with no Diagram of its own. */
  diagram: DiagramPaletteHandlers | null;
  /**
   * Navigating away flushes the pending save first — see the call site. A
   * snapshot hit is highlighted in the Snapshot Timeline, never restored.
   */
  onGoToDiagram: (target: DiagramTarget) => void | Promise<void>;
  /** See `paletteKeyCommand`: where Cmd/Ctrl+K and +F are the palette's. */
  keysFrom: "anywhere" | "canvas";
  /**
   * Told where each landed insert came from, in an editor whose drawing
   * records its sources (a Thumbnail Diagram, ADR 0060); null in one that
   * doesn't. With it, inserting a Diagram's head first pins the head as an
   * unpreserved DiagramSnapshot, and that snapshot is the source.
   */
  onInsertSource: ((source: ThumbnailDiagramSource) => void) | null;
};

/**
 * The palette's effect runner for `paletteReducer`, and the bridges that
 * report the summon shortcuts and the canvas's shape cap. Each handler does
 * one piece of I/O against the canvas, the server or the route's handlers,
 * and reports what happened as an event.
 */
export function usePalette(opts: {
  editorRef: React.RefObject<Editor | null>;
  handlers: PaletteHandlers;
}) {
  const { editorRef } = opts;
  const status = usePlaygroundStatus();
  // Read when a handler runs, so it never calls a stale prop.
  const handlersRef = useRef(opts.handlers);
  handlersRef.current = opts.handlers;
  const statusRef = useRef(status);
  statusRef.current = status;

  const [state, dispatch] = useEffectReducer<
    paletteReducer.State,
    paletteReducer.Action,
    paletteReducer.Effect
  >(paletteReducer, createInitialPaletteState(), {
    "run-root-command": (_state, { command }) => {
      const handlers = handlersRef.current.diagram;
      // The row is absent without a Diagram, so this cannot be picked.
      if (!handlers) return;
      const run = {
        "preserve-snapshot": handlers.onPreserveSnapshot,
        "restore-head": handlers.onRestoreToHead,
        "copy-contents": handlers.onCopyContents,
        "new-diagram": handlers.onNewDiagram,
        "recentre-diagram": handlers.onRecentreDiagram,
      }[command];
      void run();
    },
    "insert-icon": (_state, { name }, dispatch) => {
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
      dispatch({ type: "icon-inserted", name, landed });
    },
    "record-icon-use": (_state, { name }) => {
      recordIconUse(name);
    },
    "replace-icon": (_state, { shapeId, name }, dispatch) => {
      const editor = editorRef.current;
      if (!editor) return;
      // No size, no point, no camera: the shape already has all of that, and
      // keeping it is the entire reason this is not an insert.
      const replaced = replaceIconName(editor, shapeId, name);
      dispatch({ type: replaced ? "icon-replaced" : "icon-replace-failed" });
    },
    "save-component": (_state, { name }, dispatch) => {
      void saveComponent(editorRef.current, name).then(dispatch);
    },
    "insert-component": (_state, { componentId }, dispatch) => {
      void insertComponent(editorRef.current, componentId).then((outcome) => {
        if (outcome.type === "component-inserted" && outcome.landed) {
          handlersRef.current.onInsertSource?.({
            kind: "diagram-component",
            diagramComponentId: componentId,
          });
        }
        dispatch(outcome);
      });
    },
    "rename-component": (_state, { componentId, name }, dispatch) => {
      const body = new FormData();
      body.set("name", name);
      // A server that is down rejects the fetch: that is a failure too.
      void fetch(`/api/diagram-components/${componentId}/rename`, {
        method: "POST",
        body,
      })
        .catch(() => null)
        .then((res) =>
          dispatch(
            res?.ok
              ? { type: "component-renamed", componentId, name }
              : { type: "component-rename-failed" }
          )
        );
    },
    "delete-component": (_state, { componentId }, dispatch) => {
      void fetch(`/api/diagram-components/${componentId}/delete`, {
        method: "POST",
      })
        .catch(() => null)
        .then((res) =>
          dispatch(
            res?.ok
              ? { type: "component-deleted", componentId }
              : { type: "component-delete-failed" }
          )
        );
    },
    "list-components": (_state, _effect, dispatch) => {
      void fetch("/api/diagram-components/list")
        .then(async (res) => {
          if (!res.ok) throw new Error("Couldn't list components");
          const data = await res.json();
          dispatch({
            type: "components-listed",
            components: data.components ?? [],
          });
        })
        .catch(() => dispatch({ type: "components-list-failed" }));
    },
    "search-diagrams": (_state, { query, seq, delayMs }, dispatch) => {
      const timer = setTimeout(() => {
        void fetch(`/api/diagrams/search?q=${encodeURIComponent(query)}`)
          .then((res) => res.json())
          .then((data) => data.results ?? [])
          .catch(() => [])
          .then((hits) => dispatch({ type: "diagrams-found", seq, hits }));
      }, delayMs);
      return () => clearTimeout(timer);
    },
    "wait-for-spinner": (_state, { delayMs }, dispatch) => {
      const timer = setTimeout(
        () => dispatch({ type: "spinner-delay-elapsed" }),
        delayMs
      );
      return () => clearTimeout(timer);
    },
    "go-to-diagram": (_state, { target }, dispatch) => {
      void Promise.resolve(handlersRef.current.onGoToDiagram(target)).then(() =>
        dispatch({ type: "went-to-diagram" })
      );
    },
    "insert-diagram": (_state, { target }, dispatch) => {
      const onInsertSource = handlersRef.current.onInsertSource;
      void insertDiagram(editorRef.current, target, {
        pinHead: onInsertSource !== null,
      }).then(({ outcome, snapshotId }) => {
        if (
          outcome.type === "diagram-inserted" &&
          outcome.landed &&
          snapshotId
        ) {
          onInsertSource?.({
            kind: "diagram-snapshot",
            diagramSnapshotId: snapshotId,
          });
        }
        dispatch(outcome);
      });
    },
    "rename-diagram": (_state, { name }, dispatch) => {
      const handlers = handlersRef.current.diagram;
      if (!handlers) return;
      void Promise.resolve(handlers.onRenameDiagram(name)).then(() =>
        dispatch({ type: "diagram-renamed" })
      );
    },
    "report-error": (_state, { message }) => {
      statusRef.current.reportError(message);
    },
    "report-success": () => {
      statusRef.current.reportSuccess();
    },
  });

  /**
   * Every summon runs through here, `page` and all — an event, not a piece of
   * state reconciled by an effect, so Cmd+F pressed a second time (opened
   * onto the search, Esc back to the root, Cmd+F again) is never a dead
   * keypress. The selection is read on every summon: the palette is modal, so
   * the canvas cannot change underneath it. The recents are re-read too:
   * storage is their source of truth (see `recent-icons`).
   */
  const summon = useCallback(
    (page: PageKey | null) => {
      const selected = editorRef.current?.getSelectedShapes() ?? [];
      dispatch({
        type: "palette-summoned",
        page,
        hasSelection: selected.length > 0,
        selectedIcon: singleSelectedIcon(selected),
        recentIcons: readRecentIcons(),
        hostsDiagram: handlersRef.current.diagram !== null,
      });
    },
    [editorRef, dispatch]
  );

  /** Radix's handle on the dialog: a click away comes back through here. */
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) summon(null);
      else dispatch({ type: "palette-dismissed" });
    },
    [summon, dispatch]
  );

  // --- Shortcuts -----------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const container = editorRef.current?.getContainer();
      const command = paletteKeyCommand(e, {
        isOpen: state.open,
        keysFrom: handlersRef.current.keysFrom,
        canvasFocused:
          !!container &&
          e.target instanceof Node &&
          container.contains(e.target),
      });
      if (!command) return;
      e.preventDefault();
      // Taken in the capture phase, before Global Search's own listener on
      // the document sees the same Cmd/Ctrl+K.
      e.stopPropagation();
      if (command.command === "close") dispatch({ type: "palette-dismissed" });
      else summon(command.page);
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [state.open, summon, dispatch, editorRef]);

  // At `maxShapesPerPage`, `putContentOntoCurrentPage` bails SILENTLY — it
  // emits this event and returns. Without listening, an insert at the cap looks
  // like a dead keypress.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onMaxShapes = () =>
      status.reportError(
        "This page is full — tldraw's shape limit was reached"
      );
    editor.on("max-shapes", onMaxShapes);
    return () => {
      editor.off("max-shapes", onMaxShapes);
    };
  }, [editorRef, state.open, status]);

  const icons = useMemo(
    () =>
      searchIconNames(state.nav.query, {
        limit: ICON_RESULT_CAP,
        recent: state.recentIcons,
      }),
    [state.nav.query, state.recentIcons]
  );

  return {
    ...state,
    onOpenChange,
    page: selectPage(state),
    dispatch: dispatch as (event: paletteReducer.Action) => void,
    rootActions: selectRootActions(state),
    icons,
    components: selectComponents(state),
  };
}

/**
 * Captures the selection and POSTs it. tldraw already solves the hard part:
 * `getContentFromCurrentPage` expands the selection to descendants (so group
 * and frame children come along), keeps only bindings with BOTH ends inside
 * the selection, drops dangling ones, and rewrites root shapes into page
 * coordinates.
 */
async function saveComponent(
  editor: Editor | null,
  name: string
): Promise<paletteReducer.Action> {
  const shapeIds = editor?.getSelectedShapeIds() ?? [];
  if (!editor || shapeIds.length === 0) {
    return { type: "component-save-failed", reason: "nothing-selected" };
  }
  try {
    const content = editor.getContentFromCurrentPage(shapeIds);
    if (!content) {
      return { type: "component-save-failed", reason: "capture-failed" };
    }
    // `users` is collaborator presence — meaningless here, and the clipboard
    // envelope is a transport concern that is not persisted.
    const { users: _users, ...sceneFragment } = content;
    const thumbnailPngBase64 = await renderThumbnailPngBase64(editor, shapeIds);
    const res = await fetch("/api/diagram-components/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sceneFragment, thumbnailPngBase64 }),
    });
    return res.ok
      ? { type: "component-saved" }
      : { type: "component-save-failed", reason: "request-failed" };
  } catch {
    return { type: "component-save-failed", reason: "request-failed" };
  }
}

/** Fetches a component's fragment and puts it at the viewport's centre. */
async function insertComponent(
  editor: Editor | null,
  componentId: string
): Promise<paletteReducer.Action> {
  const failed = (
    reason: "gone" | "request-failed" | "incompatible"
  ): paletteReducer.Action => ({
    type: "component-insert-failed",
    componentId,
    reason,
  });
  if (!editor) return { type: "component-inserted", landed: false };

  let fragment: unknown;
  try {
    const res = await fetch(`/api/diagram-components/${componentId}/insert`, {
      method: "POST",
    });
    // Reachable, because delete is a hard DELETE: another window may have
    // removed it.
    if (res.status === 404) return failed("gone");
    if (!res.ok) return failed("request-failed");
    fragment = (await res.json()).sceneFragment;
  } catch {
    // A network blip leaves the palette open, so retrying is one Enter.
    return failed("request-failed");
  }

  try {
    const landed = insertContentAtViewportCentre(editor, fragment as never, {
      historyLabel: "insert component",
    });
    return { type: "component-inserted", landed };
  } catch (error) {
    // `putContentOntoCurrentPage` runs the store's migrations against the
    // stored schema and throws when it cannot migrate. The row is left
    // untouched: no broken flag, no migration-on-read backfill.
    //
    // Logged as well as reported: the message names the likeliest cause, but
    // any throw out of the put lands here, so the real one has to stay
    // reachable from the console.
    console.error("Component insert failed", error);
    return failed("incompatible");
  }
}

/**
 * Fetches a Diagram's head, or a DiagramSnapshot's drawing, and puts it onto
 * the canvas whole: one group, scaled to fit, through the single insertion
 * path. With `pinHead`, a head is first kept as an unpreserved
 * DiagramSnapshot (content-hash deduped, off the Snapshot Timeline), and
 * that drawing is what lands. `snapshotId` is the drawing that was inserted,
 * when it is a snapshot.
 */
async function insertDiagram(
  editor: Editor | null,
  target: DiagramInsertTarget,
  { pinHead }: { pinHead: boolean }
): Promise<{ outcome: paletteReducer.Action; snapshotId: string | null }> {
  const failed = {
    outcome: {
      type: "diagram-insert-failed",
      reason: "request-failed",
    } satisfies paletteReducer.Action,
    snapshotId: null,
  };
  if (!editor) {
    return {
      outcome: { type: "diagram-inserted", landed: false },
      snapshotId: null,
    };
  }

  let scene: unknown;
  let snapshotId: string | null = target.snapshotId;
  try {
    if (target.snapshotId) {
      const res = await fetch(`/api/diagram-snapshots/${target.snapshotId}`);
      if (!res.ok) return failed;
      scene = (await res.json()).scene;
    } else if (pinHead) {
      const res = await fetch(`/api/diagrams/${target.diagramId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return failed;
      const { snapshot } = await res.json();
      scene = snapshot.scene;
      snapshotId = snapshot.id;
    } else {
      const res = await fetch(`/api/diagrams/${target.diagramId}/head`);
      if (!res.ok) return failed;
      scene = (await res.json()).headScene;
    }
  } catch {
    return failed;
  }

  const content = buildSceneContent(scene);
  if (!content) {
    return {
      outcome: { type: "diagram-insert-failed", reason: "empty" },
      snapshotId: null,
    };
  }
  try {
    return {
      outcome: {
        type: "diagram-inserted",
        landed: insertDrawingAsGroup(editor, content),
      },
      snapshotId,
    };
  } catch (error) {
    // Any throw out of the put (a scene tldraw can't migrate, say) lands
    // here; logged so the real cause stays reachable from the console.
    console.error("Diagram insert failed", error);
    return failed;
  }
}

export type PaletteState = ReturnType<typeof usePalette>;
export type { PageKey };
