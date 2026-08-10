import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileX, Loader2 } from "lucide-react";
import { useFetcher } from "react-router";

export function PurgeExportsModal(props: {
  repoId: string;
  versionId: string;
  versionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileX className="w-5 h-5 text-destructive" />
            Purge Exports
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to purge all exports for version "
            {props.versionName}"? This will free up disk space but the videos
            can be re-exported later.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action={`/api/courses/${props.repoId}/purge-exports`}
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            await fetcher.submit(formData, {
              method: "post",
              action: `/api/courses/${props.repoId}/purge-exports`,
            });
            props.onOpenChange(false);
          }}
        >
          <input type="hidden" name="versionId" value={props.versionId} />
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Purge Exports"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
