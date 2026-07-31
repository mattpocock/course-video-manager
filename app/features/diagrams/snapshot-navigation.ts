/**
 * Stepping through a Diagram's timeline with Ctrl-[ (older) and Ctrl-] (newer).
 *
 * The timeline has no cursor of its own. "Where am I?" is derived from the
 * head's content hash, because **Restore to Head** copies a snapshot's scene
 * onto the head verbatim — so after a restore the head hashes to exactly the
 * snapshot it came from. That derivation is the whole of this module, kept pure
 * because the route it serves has no component tests.
 */

import type { Snapshot } from "@/features/diagrams/snapshot-list";

/** Ctrl-[ goes back in time, Ctrl-] forward. */
export type SnapshotStep = "older" | "newer";

/**
 * Which way this keypress steps, or `null` if it is not the shortcut.
 *
 * Cmd is accepted alongside Ctrl to match `usePreserveSnapshotShortcut`; extra
 * modifiers are not, since Ctrl-Shift-[ is a different chord.
 */
export function snapshotStepFromKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): SnapshotStep | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  if (e.altKey || e.shiftKey) return null;
  if (e.key === "[") return "older";
  if (e.key === "]") return "newer";
  return null;
}

/** The bits of an event target the guard below reads. */
export interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/**
 * Whether the keypress belongs to something that owns its own keyboard.
 *
 * Duck-typed rather than `instanceof`, so it is testable without a DOM. The
 * dialog check covers both the **Command Palette** and the restore
 * confirmation; the contenteditable check covers editing a shape's label,
 * where `[` is just a character.
 */
export function isTextEntryTarget(target: ShortcutTarget | null): boolean {
  if (!target) return false;
  const tag = target.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return !!target.closest?.('[role="dialog"]');
}

/**
 * Collapse runs of snapshots that hold identical content into one stop.
 *
 * Without this, stepping gets stuck: restoring a snapshot leaves the head
 * hashing to that snapshot's content, so a neighbour with the same hash would
 * resolve to the same position on the next keypress, forever. Runs are common —
 * restoring from search preserves the outgoing head first, and preserving a
 * just-restored state repeats its hash. The last of a run wins, so the cursor
 * sits at the most recent copy.
 */
function distinctStops(snapshots: readonly Snapshot[]): Snapshot[] {
  const stops: Snapshot[] = [];
  for (const snapshot of snapshots) {
    const previous = stops[stops.length - 1];
    if (previous && previous.contentHash === snapshot.contentHash) {
      stops[stops.length - 1] = snapshot;
    } else {
      stops.push(snapshot);
    }
  }
  return stops;
}

/**
 * The snapshot one step older/newer than the current head, or `null` at the
 * ends of the timeline.
 *
 * @param snapshots Oldest first, as `/api/diagrams/:id/snapshots/list` returns.
 * @param headContentHash The head's hash; `null` when the diagram has no head.
 * @param lastVisitedId The snapshot the last step landed on, used only to break
 *   ties when the same content appears twice in the timeline. Ignored the
 *   moment the head no longer holds that content — an edit, or a dismissed
 *   confirmation, invalidates it automatically.
 */
export function snapshotAtStep(
  snapshots: readonly Snapshot[],
  headContentHash: string | null,
  step: SnapshotStep,
  lastVisitedId?: string | null
): Snapshot | null {
  const stops = distinctStops(snapshots);

  let index = -1;
  if (lastVisitedId) {
    const hinted = stops.findIndex((s) => s.id === lastVisitedId);
    if (hinted !== -1 && stops[hinted]!.contentHash === headContentHash) {
      index = hinted;
    }
  }
  if (index === -1 && headContentHash !== null) {
    index = stops.findIndex((s) => s.contentHash === headContentHash);
  }
  // Unrecognised head: there are edits that live nowhere on the timeline, so
  // the author is standing just past its newest entry. One step back therefore
  // lands ON the newest snapshot rather than skipping it, and there is nothing
  // newer to step to.
  if (index === -1) index = stops.length;

  return stops[step === "older" ? index - 1 : index + 1] ?? null;
}
