import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ClipboardCopy, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";

export function DuplicateCourseModal(props: {
  courseId: string;
  currentName: string;
  currentFilePath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<{ id: string } | { error: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setError(null);
      setCopied(false);
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
        {props.currentFilePath && (
          <div className="space-y-1">
            <Label className="text-sm text-muted-foreground">
              Original path
            </Label>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-2 py-1.5 rounded text-xs flex-1 overflow-x-auto">
                {props.currentFilePath}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 h-8 w-8"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(props.currentFilePath!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    // clipboard may not be available
                  }
                }}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <ClipboardCopy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="font-medium">
            Before duplicating, prepare the new repo:
          </p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Copy the course directory to the new location</li>
            <li>
              Remove <code className="bg-muted px-1 rounded">.git</code> and{" "}
              <code className="bg-muted px-1 rounded">node_modules</code>
            </li>
            <li>
              Run <code className="bg-muted px-1 rounded">git init</code>
            </li>
            <li>Create an initial commit</li>
          </ol>
        </div>
        <fetcher.Form
          method="post"
          action={`/api/courses/${props.courseId}/duplicate`}
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const formData = new FormData(e.currentTarget);
            const name = formData.get("name") as string;
            const filePath = formData.get("filePath") as string;

            if (!name.trim()) {
              setError("Course name cannot be empty");
              return;
            }
            if (!filePath.trim()) {
              setError("File path cannot be empty");
              return;
            }
            if (name.trim() === props.currentName) {
              setError("New course name must differ from the original");
              return;
            }
            if (filePath.trim() === props.currentFilePath) {
              setError("New file path must differ from the original");
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
          <div className="space-y-2">
            <Label htmlFor="duplicate-course-path">File Path</Label>
            <Input
              id="duplicate-course-path"
              name="filePath"
              defaultValue={props.currentFilePath ?? ""}
              required
              placeholder="/path/to/new/course"
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
