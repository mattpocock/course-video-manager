import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "lucide-react";
import { useFetcher } from "react-router";

export function DeleteVideoModal(props: {
  videoId: string;
  videoTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-destructive" />
            Delete Video
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{props.videoTitle}"? The video and
            its clips will be archived and can be recovered later.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action="/api/videos/delete"
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            await fetcher.submit(formData, {
              method: "post",
              action: "/api/videos/delete",
            });
            props.onOpenChange(false);
          }}
        >
          <input type="hidden" name="videoId" value={props.videoId} />
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
                "Delete Video"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
