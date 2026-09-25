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
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

export function DuplicateCourseModal(props: {
  courseId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setError(null);
    }
  }, [props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate Course</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action={`/api/courses/${props.courseId}/duplicate`}
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const formData = new FormData(e.currentTarget);
            const name = formData.get("name") as string;

            if (!name.trim()) {
              setError("Course name cannot be empty");
              return;
            }
            if (name.trim() === props.currentName) {
              setError("New course name must differ from the original");
              return;
            }

            try {
              await fetcher.submit(e.currentTarget);
              // The action answers with a redirect, which React Router follows
              // on its own; this closes the modal behind it. The modal stays
              // mounted for as long as a Course page is open, so it has to be
              // told to close — the route change alone does not unmount it.
              props.onOpenChange(false);
            } catch {
              setError("Failed to duplicate course");
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="duplicate-course-name">Course Name</Label>
            <Input
              id="duplicate-course-name"
              name="name"
              defaultValue={`${props.currentName} (Copy)`}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state === "submitting"}>
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Duplicate"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
