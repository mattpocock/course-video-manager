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
import { useFetcher } from "react-router";

export function RenameVideoModal(props: {
  videoId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename?: (newName: string) => void;
}) {
  const fetcher = useFetcher();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Video</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action={`/api/videos/${props.videoId}/rename`}
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const newName = formData.get("name") as string;
            await fetcher.submit(e.currentTarget);
            if (props.onRename) {
              props.onRename(newName);
            } else {
              props.onOpenChange(false);
            }
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
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
