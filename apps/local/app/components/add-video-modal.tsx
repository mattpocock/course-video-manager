import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getVideoPath } from "@/lib/video-helpers";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

export function AddVideoModal(props: {
  lessonId?: string;
  videoCount: number;
  hasExplainerFolder: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addVideoFetcher = useFetcher();

  // No redirect fires on success anymore, so close the modal once the submit
  // round-trip completes. Track that we actually submitted so a stale
  // fetcher.data doesn't re-close the modal the next time it opens. Action
  // errors are not handled here — they propagate to the route error boundary.
  const didSubmit = useRef(false);
  const { onOpenChange } = props;
  useEffect(() => {
    if (addVideoFetcher.state === "submitting") {
      didSubmit.current = true;
    } else if (addVideoFetcher.state === "idle" && didSubmit.current) {
      didSubmit.current = false;
      onOpenChange(false);
    }
  }, [addVideoFetcher.state, onOpenChange]);

  if (!props.open) return null;

  const isPending = !props.lessonId;
  const isSubmitting = addVideoFetcher.state !== "idle";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Video</DialogTitle>
        </DialogHeader>
        <addVideoFetcher.Form
          method="post"
          action={
            props.lessonId
              ? `/api/lessons/${props.lessonId}/add-video`
              : undefined
          }
          onSubmit={(e) => {
            if (isPending) e.preventDefault();
          }}
          className="space-y-4 py-4"
        >
          <div className="space-y-2">
            <Label htmlFor="video-title">Video Name</Label>
            <Input
              id="video-title"
              placeholder="Problem, Solution, Explainer..."
              defaultValue={getVideoPath({
                videoCount: props.videoCount,
                hasExplainerFolder: props.hasExplainerFolder,
              })}
              name="title"
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
            <Button type="submit" disabled={isPending || isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving Lesson…
                </>
              ) : (
                "Add Video"
              )}
            </Button>
          </div>
        </addVideoFetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
