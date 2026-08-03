import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Snapshot } from "@/features/diagrams/timeline-panel";

export function RestoreSnapshotDialog({
  pendingRestore,
  onDismiss,
  onConfirm,
}: {
  pendingRestore: Snapshot | null;
  onDismiss: () => void;
  onConfirm: (snapshot: Snapshot) => void;
}) {
  return (
    <Dialog
      open={pendingRestore !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore snapshot?</DialogTitle>
          <DialogDescription>
            The current canvas is not saved as a snapshot on the timeline.
            Restoring will replace it and you won't be able to recover it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pendingRestore) {
                onDismiss();
                onConfirm(pendingRestore);
              }
            }}
          >
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
