import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useActionSubmit } from "@/hooks/use-action-submit";
import { toastOnReject } from "@/components/ui/toast";
import { useEffect, useState } from "react";

export function VideoFileManagementModal(props: {
  videoId: string;
  path?: string;
  content?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { submit, pending } = useActionSubmit();
  const [content, setContent] = useState(props.content || "");

  // Reset form when modal opens with new data
  useEffect(() => {
    setContent(props.content || "");
  }, [props.content, props.open]);

  const actionUrl = "/api/video-files/update";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit File</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          action={actionUrl}
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            toastOnReject(
              submit(actionUrl, formData).then(() => props.onOpenChange(false)),
              "Failed to save the file"
            );
          }}
        >
          <input type="hidden" name="videoId" value={props.videoId} />
          <div className="space-y-2">
            <Label htmlFor="path">Path</Label>
            {/* Read-only rather than disabled: the endpoint needs the path,
                and disabled inputs are omitted from the FormData. */}
            <Input id="path" name="path" value={props.path || ""} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              name="content"
              placeholder="Enter file content..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              className="min-h-64 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Note: Only text files can be edited. Binary files must be
              re-uploaded via clipboard.
            </p>
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
