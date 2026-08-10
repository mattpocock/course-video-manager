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
import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";

export function AddStandaloneVideoModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addVideoFetcher = useFetcher<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (addVideoFetcher.state === "idle" && addVideoFetcher.data?.id) {
      props.onOpenChange(false);
      navigate(`/videos/${addVideoFetcher.data.id}/edit`);
    }
  }, [
    addVideoFetcher.state,
    addVideoFetcher.data,
    props.onOpenChange,
    navigate,
  ]);

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
        >
          <div className="space-y-2">
            <Label htmlFor="video-path">Video Name</Label>
            <Input
              id="video-path"
              placeholder="e.g., My Video"
              name="path"
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
