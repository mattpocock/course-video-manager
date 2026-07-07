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
import { useFetcher, useNavigate } from "react-router";

export function DuplicateCourseModal(props: {
  courseId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<{ id: string } | { error: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setError(null);
    }
  }, [props.open]);

  useEffect(() => {
    if (fetcher.data && "id" in fetcher.data) {
      props.onOpenChange(false);
      navigate(`/courses/${fetcher.data.id}`);
    } else if (fetcher.data && "error" in fetcher.data) {
      setError(fetcher.data.error);
    }
  }, [fetcher.data]);

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
