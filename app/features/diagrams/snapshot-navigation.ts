/**
 * Stepping around a Diagram's timeline with Ctrl-[ (older) and Ctrl-] (newer).
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
 * The snapshot one step older/newer than the current head, or `null` when the
 * timeline holds nowhere else to go.
 *
 * The timeline is a ring: stepping past the newest stop comes back on the
 * oldest and vice versa. Histories are short and walked repeatedly, so an end
 * that stops dead — and toasts to say so — just means reversing the chord all
 * the way back to reach the other side.
 *
 * `null` is therefore only for a timeline with no other place to stand: no
 * snapshots at all, or a single stop the head is already on, where wrapping
 * would restore the canvas onto itself.
 *
 * Stops holding the head's own content are stepped over rather than landed on,
 * for the reason `distinctStops` collapses adjacent ones — see below.
 *
 * @param snapshots Oldest first, as `/api/diagrams/:id/snapshots/list` returns.
 * @param headContentHash The head's hash; `null` when the diagram has no head.
 * @param lastVisitedId The snapshot the last step landed on, or `null` before
 *   the first step of a run. Used only to break ties when the same content
 *   appears twice in the timeline, and ignored the moment the head no longer
 *   holds that content — an edit, or a dismissed confirmation, invalidates it
 *   automatically. Required rather than optional: forgetting to thread it
 *   through silently strands the author on a repeated state.
 */
export function snapshotAtStep(
  snapshots: readonly Snapshot[],
  headContentHash: string | null,
  step: SnapshotStep,
  lastVisitedId: string | null
): Snapshot | null {
  const stops = distinctStops(snapshots);
  if (stops.length === 0) return null;

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
  // lands ON the newest snapshot rather than skipping it, and one step forward
  // is already off the end — so it wraps to the oldest, like the newest stop
  // itself does.
  if (index === -1) index = stops.length;

  const direction = step === "older" ? -1 : 1;
  let target = index + direction;
  // One lap at most. The head's own stop is always the last candidate, so a
  // ring holding nothing but the head's content runs out here.
  for (let tried = 0; tried < stops.length; tried++) {
    // Clamped rather than `%`: the unsaved place sits at `stops.length`, so a
    // forward step from it reaches one *past* the end, which modulo would land
    // on the second-oldest stop instead of the oldest.
    if (target < 0) target = stops.length - 1;
    else if (target >= stops.length) target = 0;

    // Restoring content the head already holds leaves the canvas exactly as it
    // is, so the chord reads as dead. That is `distinctStops`' rule applied to
    // copies that are *not* adjacent: the head's hash cannot say which of them
    // the author is looking at, so a wrap can otherwise aim straight at the
    // copy they are already standing on.
    if (stops[target]!.contentHash !== headContentHash) return stops[target]!;
    target += direction;
  }
  return null;
}
