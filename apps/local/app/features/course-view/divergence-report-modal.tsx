import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardCopy } from "lucide-react";
import { toast } from "sonner";

export function DivergenceReportModal(props: {
  report: string | null;
  onClose: () => void;
}) {
  const handleCopy = async () => {
    if (!props.report) return;
    try {
      await navigator.clipboard.writeText(props.report);
      toast("Divergence report copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <Dialog
      open={props.report !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Repository Out of Sync</DialogTitle>
          <DialogDescription>
            Your repo is out of sync — copy this report and hand it to an agent
            to reconcile.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-sm whitespace-pre-wrap break-words">
          {props.report}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Close
          </Button>
          <Button onClick={handleCopy}>
            <ClipboardCopy className="mr-1 h-4 w-4" />
            Copy Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
