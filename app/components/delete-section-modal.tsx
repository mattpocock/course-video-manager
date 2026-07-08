import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";

export function DeleteSectionModal(props: {
  sectionId: string;
  sectionTitle: string;
  lessonCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-destructive" />
            Delete Section
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{props.sectionTitle}"?
            {props.lessonCount > 0 && (
              <>
                {" "}
                This will permanently delete {props.lessonCount}{" "}
                {props.lessonCount === 1 ? "lesson" : "lessons"} in this
                section.
              </>
            )}{" "}
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end space-x-2 pt-4">
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            type="button"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              props.onDelete();
              props.onOpenChange(false);
            }}
          >
            Delete Section
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
