import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

export function AddLessonModal(props: {
  sectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddLesson: (opts: { title: string }) => void;
  adjacentLessonId?: string | null;
  position?: "before" | "after" | null;
}) {
  const [title, setTitle] = useState("");

  const isValid = title.trim().length > 0;

  const dialogTitle =
    props.position === "before"
      ? "Add Lesson Before"
      : props.position === "after"
        ? "Add Lesson After"
        : "Add Lesson";

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setTitle("");
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValid) return;
            props.onAddLesson({
              title: title.trim(),
            });
            setTitle("");
            props.onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="lesson-title">Title</Label>
            <Input
              id="lesson-title"
              name="title"
              placeholder="e.g. Understanding Generics"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => {
                setTitle("");
                props.onOpenChange(false);
              }}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Add Lesson
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
