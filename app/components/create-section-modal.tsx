import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useRef, useState } from "react";

export function CreateSectionModal(props: {
  repoVersionId: string;
  maxOrder: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSection: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isValid = title.trim().length > 0;

  useEffect(() => {
    if (!props.open) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 100);
    return () => clearTimeout(timer);
  }, [props.open]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setTitle("");
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Section</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValid) return;
            props.onCreateSection(title.trim());
            setTitle("");
            props.onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="section-title">Title</Label>
            <Input
              ref={inputRef}
              id="section-title"
              name="title"
              placeholder="e.g. Advanced Patterns"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
              Create Section
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
