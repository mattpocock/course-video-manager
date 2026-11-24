import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "lucide-react";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { toastOnReject } from "@/components/ui/toast";

export function DeleteVideoFileModal(props: {
  videoId: string;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { submit, pending } = useActionSubmit();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-destructive" />
            Delete File
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{props.path}"? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          method="post"
          action="/api/video-files/delete"
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            toastOnReject(
              submit("/api/video-files/delete", formData).then(() =>
                props.onOpenChange(false)
              ),
              "Failed to delete the file"
            );
          }}
        >
          <input type="hidden" name="videoId" value={props.videoId} />
          <input type="hidden" name="path" value={props.path} />
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete File"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
