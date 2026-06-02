import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";

export function EditLessonDescriptionModal(props: {
  lessonTitle: string;
  currentDescription: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (description: string) => void;
}) {
  const [value, setValue] = useState(props.currentDescription);

  useEffect(() => {
    setValue(props.currentDescription);
  }, [props.currentDescription, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Description</DialogTitle>
          <p className="text-sm text-muted-foreground">{props.lessonTitle}</p>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave(value);
            props.onOpenChange(false);
          }}
        >
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="What should this lesson teach?"
            className="text-sm min-h-[120px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
