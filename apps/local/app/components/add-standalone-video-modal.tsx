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

export function AddStandaloneVideoModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addVideoFetcher = useFetcher();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Video</DialogTitle>
        </DialogHeader>
        <addVideoFetcher.Form
          method="post"
          action="/api/videos/create"
          className="space-y-4 py-4"
          // The action answers with a redirect, which React Router follows on
          // its own. The fetcher lives on this component, not inside the
          // dialog content, so closing here does not cancel the submission.
          onSubmit={() => props.onOpenChange(false)}
        >
          <input type="hidden" name="redirectTo" value="/videos/{id}/edit" />
          <div className="space-y-2">
            <Label htmlFor="video-title">Video Name</Label>
            <Input
              id="video-title"
              placeholder="e.g., My Video"
              name="title"
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
            <Button type="submit" disabled={addVideoFetcher.state !== "idle"}>
              {addVideoFetcher.state !== "idle" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Create Video"
              )}
            </Button>
          </div>
        </addVideoFetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
