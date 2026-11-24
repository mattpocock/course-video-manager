import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { toastOnReject } from "@/components/ui/toast";

export function RenameVideoModal(props: {
  videoId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename?: (newName: string) => void;
}) {
  const { submit, pending } = useActionSubmit();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Video</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          action={`/api/videos/${props.videoId}/rename`}
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const newName = formData.get("name") as string;
            toastOnReject(
              submit(`/api/videos/${props.videoId}/rename`, formData).then(
                () => {
                  if (props.onRename) {
                    props.onRename(newName);
                  } else {
                    props.onOpenChange(false);
                  }
                }
              ),
              "Failed to rename the video"
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="video-name">Video Name</Label>
            <Input
              id="video-name"
              name="name"
              defaultValue={props.currentName}
              required
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
