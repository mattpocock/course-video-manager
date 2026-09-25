import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFetcher } from "react-router";

interface AddCourseModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddCourseModal({ isOpen, onOpenChange }: AddCourseModalProps) {
  const fetcher = useFetcher();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Course</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action="/api/courses/add-course"
          className="space-y-4 py-4"
          // The action answers with a redirect, which React Router follows on
          // its own. The fetcher lives on this component, not inside the
          // dialog content, so closing here does not cancel the submission.
          onSubmit={() => onOpenChange(false)}
        >
          <div className="space-y-2">
            <Label htmlFor="course-name">Course Name</Label>
            <Input
              id="course-name"
              placeholder="e.g., Total TypeScript"
              name="name"
              required
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Adding..." : "Add Course"}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
