import { useEffect } from "react";
import { toast } from "sonner";
import {
  fetchSnapshotList,
  type Snapshot,
} from "@/features/diagrams/snapshot-list";
import {
  isTextEntryTarget,
  snapshotStepFromKey,
  type ShortcutTarget,
  type SnapshotStep,
} from "@/features/diagrams/snapshot-navigation";
import { createSnapshotStepper } from "@/features/diagrams/snapshot-stepper";

/**
 * Ctrl-[ / Ctrl-] stepping through the **Snapshot Timeline**.
 *
 * A keyboard route to the restore the timeline already performs — same
 * endpoint, same handler, so the "you'll lose the current canvas" confirmation
 * still appears exactly when clicking a timeline row would raise it. Nothing
 * here is a second implementation of restore.
 *
 * The list is re-read on every keypress rather than mirrored in state: the
 * timeline is hidden in Focus Mode, snapshots arrive from the video editor
 * while the author draws, and a stale head hash would step from the wrong place.
 */
export function useSnapshotStepShortcut(opts: {
  diagramId: string | undefined;
  /** Cancels the debounced autosave and lands it now. */
  flushPendingSave: () => Promise<void>;
  /** Resolves once the head has moved, or immediately if a dialog intercepts. */
  onRestoreRequest: (
    snapshot: Snapshot,
    headIsCaptured: boolean
  ) => Promise<void> | void;
}) {
  const { diagramId, flushPendingSave, onRestoreRequest } = opts;

  useEffect(() => {
    if (!diagramId) return;

    // Scoped to the effect, so switching diagrams starts a fresh run rather
    // than carrying a tie-break hint onto a timeline it does not belong to.
    const stepper = createSnapshotStepper({
      readTimeline: () => fetchSnapshotList(diagramId),
      flushPendingSave,
      requestRestore: onRestoreRequest,
    });

    async function step(direction: SnapshotStep) {
      const outcome = await stepper.step(direction);
      if (outcome.kind === "unavailable") {
        toast.error("Failed to load snapshots");
      } else if (outcome.kind === "nowhere-to-go") {
        toast.info("No other snapshot to step to");
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const direction = snapshotStepFromKey(e);
      if (!direction) return;
      if (isTextEntryTarget(e.target as ShortcutTarget | null)) return;
      e.preventDefault();
      void step(direction);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diagramId, flushPendingSave, onRestoreRequest]);
}
