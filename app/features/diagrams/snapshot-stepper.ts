/**
 * The sequencing behind a **Snapshot Step**: flush, read, aim, restore — with
 * one step in flight at a time.
 *
 * Split out of the React hook so the ordering guarantees are testable without a
 * DOM. Everything it touches is injected, and it reports what happened rather
 * than toasting, so the caller owns the wording.
 */

import {
  isHeadCaptured,
  type Snapshot,
  type SnapshotListResponse,
} from "@/features/diagrams/snapshot-list";
import {
  snapshotAtStep,
  type SnapshotStep,
} from "@/features/diagrams/snapshot-navigation";

export type SnapshotStepOutcome =
  /** A restore was raised for `snapshot` — possibly behind the confirm dialog. */
  | { kind: "stepped"; snapshot: Snapshot }
  /**
   * The timeline holds no other place to stand — empty, or a single stop the
   * head is already on. Reaching an *end* is not this: stepping wraps.
   */
  | { kind: "nowhere-to-go" }
  /** The timeline could not be read. */
  | { kind: "unavailable" }
  /** A step is still settling; this keypress was dropped. */
  | { kind: "busy" };

export interface SnapshotStepper {
  step: (direction: SnapshotStep) => Promise<SnapshotStepOutcome>;
}

export function createSnapshotStepper(deps: {
  /** Reads the timeline; `null` when it could not be read. */
  readTimeline: () => Promise<SnapshotListResponse | null>;
  /** Cancels the debounced autosave and lands it now. */
  flushPendingSave: () => Promise<void>;
  /**
   * Raises the restore through the surrounding chrome's own handler, so the
   * "you'll lose the current canvas" confirmation still appears exactly when
   * clicking a timeline row would raise it.
   *
   * Must not resolve until the head has actually moved — see `inFlight`.
   */
  requestRestore: (
    snapshot: Snapshot,
    headIsCaptured: boolean
  ) => Promise<void> | void;
}): SnapshotStepper {
  /**
   * Held for the whole step, restore included.
   *
   * Releasing it when the *read* finished would let a held-down chord start the
   * next step against a head the in-flight restore has not moved yet: the
   * second step re-aims at the snapshot already being restored, and its
   * `flushPendingSave` can PATCH the pre-restore scene back over the restored
   * head after the restore has committed.
   */
  let inFlight = false;

  // Only breaks ties between snapshots holding identical content; see
  // `snapshotAtStep`, which discards it as soon as the head moves elsewhere.
  let lastVisitedId: string | null = null;

  return {
    async step(direction) {
      if (inFlight) return { kind: "busy" };
      inFlight = true;
      try {
        // The server's head hash decides where the cursor is, so the debounced
        // edits have to land before it is read — otherwise the author's latest
        // work reads as "already on the newest snapshot".
        await deps.flushPendingSave();

        const list = await deps.readTimeline();
        if (!list) return { kind: "unavailable" };

        const snapshots = list.snapshots ?? [];
        const target = snapshotAtStep(
          snapshots,
          list.headContentHash,
          direction,
          lastVisitedId
        );
        if (!target) return { kind: "nowhere-to-go" };

        // Set before the request so a confirmed dialog lands on the right
        // cursor. A dismissed one leaves the head where it was, which makes
        // this hint stale and therefore ignored.
        lastVisitedId = target.id;
        await deps.requestRestore(
          target,
          isHeadCaptured(snapshots, list.headContentHash)
        );
        return { kind: "stepped", snapshot: target };
      } catch {
        return { kind: "unavailable" };
      } finally {
        inFlight = false;
      }
    },
  };
}
