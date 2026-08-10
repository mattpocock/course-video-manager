import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Modal dialog for creating a new video from selected clips and sections.
 *
 * Features:
 * - Title input field (required, auto-focused)
 * - "Remove from original" checkbox (default: unchecked = copy mode)
 * - Save and Cancel buttons
 *
 * On submit, calls the onSubmit callback with the title and mode.
 */
export function CreateVideoFromSelectionModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, mode: "copy" | "move") => void;
}) {
  const [removeFromOriginal, setRemoveFromOriginal] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get("title") as string;
    onSubmit(title, removeFromOriginal ? "move" : "copy");
    onOpenChange(false);
    // Reset state for next open
    setRemoveFromOriginal(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
    // Reset state for next open
    setRemoveFromOriginal(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Video from Selection</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 py-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="video-title">Video Title</Label>
            <Input
              id="video-title"
              name="title"
              autoFocus
              placeholder="Enter video title"
              required
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="removeFromOriginal"
              checked={removeFromOriginal}
              onCheckedChange={(checked) =>
                setRemoveFromOriginal(checked === true)
              }
            />
            <Label htmlFor="removeFromOriginal" className="text-sm font-normal">
              Remove from original video
            </Label>
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={handleCancel} type="button">
              Cancel
            </Button>
            <Button type="submit">Create Video</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
