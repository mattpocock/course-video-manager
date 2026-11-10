import { useMemo } from "react";
import { useNavigate, useRevalidator } from "react-router";
import {
  fetchSnapshotList,
  type Snapshot,
} from "@/features/diagrams/snapshot-list";
import { usePlaygroundStatus } from "@/features/diagrams/playground-status";
import type { PaletteHandlers } from "./use-palette";

/**
 * The mirror layer: maps each palette action onto the handler the surrounding
 * chrome already calls.
 *
 * The palette adds a keyboard route to these actions rather than replacing the
 * one that exists — the right-rail timeline is untouched, and nothing here is a
 * second implementation of anything.
 */
/** What the route hands the palette: the handlers its own chrome already uses. */
export type PaletteWiring = {
  diagramId: string;
  /** Cancels the debounced autosave and lands it now. */
  flushPendingSave: () => Promise<void>;
  preserveSnapshot: () => void;
  handleRestoreRequest: (snapshot: Snapshot, timeline: Snapshot[]) => void;
  handleCopyDiagramContents: (id: string) => Promise<void>;
  handleCreateDiagram: () => void;
  /** Re-reads head from the server and loads it into the editor. */
  reloadScene: (id: string) => void;
  /** The same camera move the manual Cmd/Ctrl+0 shortcut runs. */
  recentreDiagram: () => void;
};

export function usePaletteHandlers(opts: PaletteWiring): PaletteHandlers {
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
  const status = usePlaygroundStatus();

  return useMemo(
    () => ({
      onPreserveSnapshot: preserveSnapshot,

      onRecentreDiagram: recentreDiagram,

      onRestoreToHead: async () => {
        // "Discard changes since the last snapshot" — the same restore the
        // timeline performs, on the newest snapshot, and through the same
        // handler, so a head the timeline doesn't hold is kept as a snapshot
        // before it is discarded.
        const data = await fetchSnapshotList(diagramId);
        if (!data) {
          status.reportError("Failed to load snapshots");
          return;
        }
        // The list comes back oldest-first.
        const newest: Snapshot | undefined =
          data.snapshots?.[data.snapshots.length - 1];
        if (!newest) {
          status.reportError("No snapshots to restore");
          return;
        }
        handleRestoreRequest(newest, data.snapshots);
      },

      onCopyContents: () => handleCopyDiagramContents(diagramId),

      onRenameDiagram: async (name: string) => {
        const body = new FormData();
        body.set("name", name);
        const res = await fetch(`/api/diagrams/${diagramId}/update`, {
          method: "POST",
          body,
        }).catch(() => null);
        if (!res?.ok) {
          status.reportError("Failed to rename diagram");
          return;
        }
        status.reportSuccess();
        revalidator.revalidate().catch(() => {
          status.reportError("Failed to refresh after renaming the diagram");
        });
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
            // Reported, unlike on Home: when the hit is in the diagram already
            // open, a silent failure would leave the author looking at an
            // unchanged canvas with nothing to explain it.
            if (!res.ok) status.reportError("Failed to restore that snapshot");
          } catch {
            status.reportError("Failed to restore that snapshot");
          }
        }

        // Same diagram: React Router has nowhere to navigate to, so the route's
        // "reload on id change" effect never fires and the canvas would keep
        // showing the pre-restore scene — which the next autosave would then
        // write back over the restore. Reload it explicitly.
        if (target.diagramId === diagramId) {
          reloadScene(diagramId);
          return;
        }
        Promise.resolve(
          navigate(`/diagram-playground/${target.diagramId}`)
        ).catch(() => {
          status.reportError("Failed to open that diagram");
        });
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
      status,
    ]
  );
}
