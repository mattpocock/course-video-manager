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

export function RenameCourseModal(props: {
  courseId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { submit, pending } = useActionSubmit();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Course</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          action={`/api/courses/${props.courseId}/rename-course`}
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            toastOnReject(
              submit(
                `/api/courses/${props.courseId}/rename-course`,
                new FormData(e.currentTarget)
              ).then(() => props.onOpenChange(false)),
              "Failed to rename the course"
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="course-name">Course Name</Label>
            <Input
              id="course-name"
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
