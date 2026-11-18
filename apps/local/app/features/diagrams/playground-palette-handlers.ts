import { useMemo } from "react";
import { useNavigate, useRevalidator } from "react-router";
import {
  fetchSnapshotList,
  type Snapshot,
} from "@/features/diagrams/snapshot-list";
import type { PlaygroundStatus } from "@/features/diagrams/playground-status";
import { highlightedSnapshotUrl } from "@/lib/diagram-protocol";
import type { PaletteHandlers } from "@/features/diagrams/palette/use-palette";

/**
 * The Diagram Playground's mirror layer: maps each palette action onto the
 * handler the surrounding chrome already calls. These are the playground's own
 * Diagram actions; the shared Diagram Editor only receives the result.
 *
 * The palette adds a keyboard route to these actions rather than replacing the
 * one that exists — the right-rail timeline is untouched, and nothing here is a
 * second implementation of anything.
 */
/** What the route hands the palette: the handlers its own chrome already uses. */
export type PlaygroundPaletteWiring = {
  /** The Active Diagram; none means no palette (the route's own "no id"). */
  diagramId: string | undefined;
  /** The route's status line; the route renders its own provider. */
  status: PlaygroundStatus;
  /** Cancels the debounced autosave and lands it now. */
  flushPendingSave: () => Promise<void>;
  preserveSnapshot: () => void;
  handleRestoreRequest: (snapshot: Snapshot, timeline: Snapshot[]) => void;
  handleCopyDiagramContents: (id: string) => Promise<void>;
  handleCreateDiagram: () => void;
  /** The same camera move the manual Cmd/Ctrl+0 shortcut runs. */
  recentreDiagram: () => void;
};

export function usePlaygroundPaletteHandlers(
  opts: PlaygroundPaletteWiring
): PaletteHandlers | null {
  const {
    diagramId,
    status,
    flushPendingSave,
    preserveSnapshot,
    handleRestoreRequest,
    handleCopyDiagramContents,
    handleCreateDiagram,
    recentreDiagram,
  } = opts;

  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return useMemo(() => {
    if (!diagramId) return null;
    const diagram = {
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
    };
    return {
      diagram,
      // Global Search is not mounted on the playground: the keys are ours.
      keysFrom: "anywhere",
      onGoToDiagram: async (target) => {
        // Every existing flow that leaves the current diagram flushes first;
        // without this, up to 500ms of edits is lost on every jump.
        await flushPendingSave();

        // A snapshot hit is only highlighted in the Snapshot Timeline, never
        // restored: the head, and so the next Clip, stays as it is. Restore
        // to Head is its own explicit action.
        Promise.resolve(
          navigate(
            highlightedSnapshotUrl(target.diagramId, target.highlightSnapshotId)
          )
        ).catch(() => {
          status.reportError("Failed to open that diagram");
        });
      },
    };
  }, [
    diagramId,
    flushPendingSave,
    preserveSnapshot,
    handleRestoreRequest,
    handleCopyDiagramContents,
    handleCreateDiagram,
    recentreDiagram,
    navigate,
    revalidator,
    status,
  ]);
}
