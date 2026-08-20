import { useMemo } from "react";
import { toast } from "sonner";
import { useNavigate, useRevalidator } from "react-router";
import {
  fetchSnapshotList,
  isHeadCaptured,
  type Snapshot,
} from "@/features/diagrams/snapshot-list";
import type { PaletteHandlers } from "./use-palette";

/**
 * The mirror layer: maps each palette action onto the handler the surrounding
 * chrome already calls.
 *
 * The palette adds a keyboard route to these actions rather than replacing the
 * one that exists — the right-rail timeline is untouched, and nothing here is a
 * second implementation of anything.
 */
export function usePaletteHandlers(opts: {
  diagramId: string;
  /** Cancels the debounced autosave and lands it now. */
  flushPendingSave: () => Promise<void>;
  preserveSnapshot: () => Promise<void>;
  handleRestoreRequest: (snapshot: Snapshot, headIsCaptured: boolean) => void;
  handleCopyDiagramContents: (id: string) => Promise<void>;
  handleCreateDiagram: () => Promise<void>;
  /** Re-reads head from the server and loads it into the editor. */
  reloadScene: (id: string) => Promise<void>;
  /** The same camera move the manual Cmd/Ctrl+0 shortcut runs. */
  recentreDiagram: () => void;
}): PaletteHandlers {
  const {
    diagramId,
    flushPendingSave,
    preserveSnapshot,
    handleRestoreRequest,
    handleCopyDiagramContents,
    handleCreateDiagram,
    reloadScene,
    recentreDiagram,
  } = opts;

  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return useMemo(
    () => ({
      onPreserveSnapshot: preserveSnapshot,

      onRecentreDiagram: recentreDiagram,

      onRestoreToHead: async () => {
        // "Discard changes since the last snapshot" — the same restore the
        // timeline performs, on the newest snapshot, and through the same
        // handler, so the confirm dialog still appears when the head is not
        // already captured on the timeline.
        const data = await fetchSnapshotList(diagramId);
        if (!data) {
          toast.error("Failed to load snapshots");
          return;
        }
        // The list comes back oldest-first.
        const newest: Snapshot | undefined =
          data.snapshots?.[data.snapshots.length - 1];
        if (!newest) {
          toast.error("No snapshots to restore");
          return;
        }
        handleRestoreRequest(
          newest,
          isHeadCaptured(data.snapshots, data.headContentHash)
        );
      },

      onCopyContents: () => handleCopyDiagramContents(diagramId),

      onRenameDiagram: async (name: string) => {
        const body = new FormData();
        body.set("name", name);
        const res = await fetch(`/api/diagrams/${diagramId}/update`, {
          method: "POST",
          body,
        });
        if (!res.ok) {
          toast.error("Failed to rename diagram");
          return;
        }
        revalidator.revalidate();
      },

      onNewDiagram: handleCreateDiagram,

      onGoToDiagram: async (target) => {
        // Every existing flow that leaves the current diagram flushes first;
        // without this, up to 500ms of edits is lost on every jump.
        await flushPendingSave();

        // A snapshot hit means "take me to that state", so it goes through the
        // SAME endpoint Playground Home's search box uses: `restore-from-search`
        // preserves the current head as a snapshot of its own before restoring,
        // so nothing is lost and the timeline records the detour.
        if (target.source === "snapshot" && target.snapshotId) {
          try {
            const res = await fetch(
              `/api/diagrams/${target.diagramId}/restore-from-search`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ snapshotId: target.snapshotId }),
              }
            );
            // Toasted, unlike on Home: when the hit is in the diagram already
            // open, a silent failure would leave the author looking at an
            // unchanged canvas with nothing to explain it.
            if (!res.ok) toast.error("Failed to restore that snapshot");
          } catch {
            toast.error("Failed to restore that snapshot");
          }
        }

        // Same diagram: React Router has nowhere to navigate to, so the route's
        // "reload on id change" effect never fires and the canvas would keep
        // showing the pre-restore scene — which the next autosave would then
        // write back over the restore. Reload it explicitly.
        if (target.diagramId === diagramId) {
          await reloadScene(diagramId);
          return;
        }
        navigate(`/diagram-playground/${target.diagramId}`);
      },
    }),
    [
      diagramId,
      flushPendingSave,
      preserveSnapshot,
      handleRestoreRequest,
      handleCopyDiagramContents,
      handleCreateDiagram,
      reloadScene,
      recentreDiagram,
      navigate,
      revalidator,
    ]
  );
}
