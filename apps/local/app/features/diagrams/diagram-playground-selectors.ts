import type { diagramPlaygroundReducer } from "./diagram-playground-reducer";

/** Selectors over `diagramPlaygroundReducer.State` (docs/FRONTEND_STATE.md rule 6). */

type State = diagramPlaygroundReducer.State;

/**
 * Anything but a loaded head is read-only, so no edit is made that can't be
 * saved; so is a canvas a restore is about to replace, so no edit lands after
 * its last save and is lost under the restored snapshot.
 */
export const isCanvasEditable = (state: State) =>
  state.head?.status === "ready" && state.restoring === null;

/**
 * The canvas holds edits the server refused to save over a head changed
 * elsewhere. Leaving now would drop them, so they're kept as a snapshot first.
 */
export const mustKeepCanvasBeforeLeaving = (state: State) =>
  state.head?.status === "ready" &&
  state.head.changedElsewhere &&
  !state.head.keptAsSnapshot;

/**
 * What leaving the open diagram has to wait for: its pending edits saved, or
 * a canvas the server refused kept as a snapshot. `null` lets it go at once.
 * The navigation blocker asks this too, so it holds exactly what the reducer
 * would make wait.
 */
export const leaveMustWaitFor = (
  state: State,
  canvasHasUnsavedEdits: boolean
): "save" | "keep-canvas" | null => {
  if (mustKeepCanvasBeforeLeaving(state)) return "keep-canvas";
  // A refused canvas already kept, or waiting on the prompt, has no save to make.
  if (
    canvasHasUnsavedEdits &&
    state.head?.status === "ready" &&
    !state.head.changedElsewhere
  ) {
    return "save";
  }
  return null;
};

/**
 * The content hash of the snapshot the canvas is showing, if it is one: the
 * stored head this tab last loaded or saved, while nothing has been edited
 * since. A snapshot whose `contentHash` equals it is the one on screen, so
 * the timeline marks it. An edit makes the canvas no snapshot at all, so it
 * gives `null` from the moment its save starts: a "modified" mark would still
 * point at a snapshot that is no longer what's on screen.
 */
export const activeSnapshotHash = (state: State): string | null => {
  const head = state.head;
  if (head?.status !== "ready" || head.saving || head.changedElsewhere)
    return null;
  return head.seen?.hash ?? null;
};

/**
 * The playground's own buttons in the canvas's bottom-right corner — the
 * centering debug toggle, the connection indicator and Preserve Snapshot.
 * On a landscape take that corner is under the face-cam; on a Short it is on
 * camera, so they're not drawn at all.
 */
export const showsCornerButtons = (state: State) => state.format !== "short";
