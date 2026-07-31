import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  isHeadPreserved,
  type Snapshot,
  type SnapshotListResponse,
} from "@/features/diagrams/snapshot-list";
import {
  isTextEntryTarget,
  snapshotAtStep,
  snapshotStepFromKey,
  type ShortcutTarget,
  type SnapshotStep,
} from "@/features/diagrams/snapshot-navigation";

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
  onRestoreRequest: (snapshot: Snapshot, headIsPreserved: boolean) => void;
}) {
  const { diagramId, flushPendingSave, onRestoreRequest } = opts;

  // Only breaks ties between snapshots holding identical content; see
  // `snapshotAtStep`, which discards it as soon as the head moves elsewhere.
  const lastVisitedId = useRef<string | null>(null);
  const stepping = useRef(false);

  useEffect(() => {
    if (!diagramId) return;

    async function step(direction: SnapshotStep) {
      // Holding the chord would otherwise fire a restore per repeat, each one
      // racing the last on the same head.
      if (stepping.current) return;
      stepping.current = true;
      try {
        // The server's head hash decides where the cursor is, so the debounced
        // edits have to land before it is read — otherwise the author's latest
        // work reads as "already on the newest snapshot".
        await flushPendingSave();

        const res = await fetch(`/api/diagrams/${diagramId}/snapshots/list`);
        if (!res.ok) {
          toast.error("Failed to load snapshots");
          return;
        }
        const data = (await res.json()) as SnapshotListResponse;
        const snapshots = data.snapshots ?? [];

        const target = snapshotAtStep(
          snapshots,
          data.headContentHash,
          direction,
          lastVisitedId.current
        );
        if (!target) {
          toast.info(
            direction === "older" ? "No older snapshot" : "No newer snapshot"
          );
          return;
        }

        // Set before the request so a confirmed dialog lands on the right
        // cursor. A dismissed one leaves the head where it was, which makes
        // this hint stale and therefore ignored.
        lastVisitedId.current = target.id;
        onRestoreRequest(
          target,
          isHeadPreserved(snapshots, data.headContentHash)
        );
      } catch {
        toast.error("Failed to load snapshots");
      } finally {
        stepping.current = false;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const direction = snapshotStepFromKey(e);
      if (!direction) return;
      if (isTextEntryTarget(e.target as ShortcutTarget | null)) return;
      e.preventDefault();
      void step(direction);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [diagramId, flushPendingSave, onRestoreRequest]);
}
