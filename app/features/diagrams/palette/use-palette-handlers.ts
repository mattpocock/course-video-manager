import { useMemo } from "react";
import { toast } from "sonner";
import { useNavigate, useRevalidator } from "react-router";
import type { Snapshot } from "@/features/diagrams/timeline-panel";
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
  handleRestoreRequest: (snapshot: Snapshot, headIsPreserved: boolean) => void;
  handleCopyDiagramContents: (id: string) => Promise<void>;
  handleCreateDiagram: () => Promise<void>;
}): PaletteHandlers {
  const {
    diagramId,
    flushPendingSave,
    preserveSnapshot,
    handleRestoreRequest,
    handleCopyDiagramContents,
    handleCreateDiagram,
  } = opts;

  const navigate = useNavigate();
  const revalidator = useRevalidator();

  return useMemo(
    () => ({
      onPreserveSnapshot: preserveSnapshot,

      onRestoreToHead: async () => {
        // "Discard changes since the last snapshot" — the same restore the
        // timeline performs, on the newest snapshot, and through the same
        // handler, so the confirm dialog still appears when the head is not
        // already preserved.
        try {
          const res = await fetch(`/api/diagrams/${diagramId}/snapshots/list`);
          if (!res.ok) {
            toast.error("Failed to load snapshots");
            return;
          }
          const data = await res.json();
          // The list comes back oldest-first.
          const newest: Snapshot | undefined =
            data.snapshots?.[data.snapshots.length - 1];
          if (!newest) {
            toast.error("No snapshots to restore");
            return;
          }
          const headIsPreserved =
            data.headContentHash != null &&
            data.snapshots.some(
              (s: Snapshot) =>
                s.preserved && s.contentHash === data.headContentHash
            );
          handleRestoreRequest(newest, headIsPreserved);
        } catch {
          toast.error("Failed to load snapshots");
        }
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

      onGoToDiagram: async (targetId: string) => {
        // Every existing flow that leaves the current diagram flushes first;
        // without this, up to 500ms of edits is lost on every jump.
        await flushPendingSave();
        navigate(`/diagram-playground/${targetId}`);
      },
    }),
    [
      diagramId,
      flushPendingSave,
      preserveSnapshot,
      handleRestoreRequest,
      handleCopyDiagramContents,
      handleCreateDiagram,
      navigate,
      revalidator,
    ]
  );
}
