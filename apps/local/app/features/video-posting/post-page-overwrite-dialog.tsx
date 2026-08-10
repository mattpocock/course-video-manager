import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PostPageOverwriteDialog({
  field,
  currentText,
  pendingText,
  onConfirm,
  onCancel,
}: {
  field: string | null;
  currentText: string;
  pendingText: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={field !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace existing content?</DialogTitle>
          <DialogDescription>
            The {field} field already has content. Do you want to replace it?
          </DialogDescription>
        </DialogHeader>
        {currentText && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-destructive mb-1">Removing:</p>
              <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
                {currentText}
              </pre>
            </div>
            <div>
              <p className="font-medium text-green-600 mb-1">Adding:</p>
              <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
                {pendingText}
              </pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
