import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ChapterNamingModal } from "../types";
import type { FrontendId } from "../clip-state-reducer";

/** Modal dialog for creating, editing, or adding chapters. */
export function ChapterNamingModal({
  modalState,
  onClose,
  onAddChapter,
  onUpdateChapter,
  onAddChapterAt,
}: {
  modalState: ChapterNamingModal;
  onClose: () => void;
  onAddChapter: (name: string) => void;
  onUpdateChapter: (chapterId: FrontendId, name: string) => void;
  onAddChapterAt: (
    name: string,
    position: "before" | "after",
    itemId: FrontendId
  ) => void;
}) {
  const handleDismiss = () => {
    onClose();
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    if (modalState?.mode === "create") {
      onAddChapter(name);
    } else if (modalState?.mode === "edit") {
      onUpdateChapter(modalState.chapterId, name);
    } else if (modalState?.mode === "add-at") {
      onAddChapterAt(name, modalState.position, modalState.itemId);
    }
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog
      open={modalState !== null}
      onOpenChange={(open) => !open && handleDismiss()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {modalState?.mode === "create"
              ? "Name Chapter"
              : modalState?.mode === "add-at"
                ? "Name Chapter"
                : "Edit Chapter"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4 py-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="chapter-name">Chapter Name</Label>
            <Input
              id="chapter-name"
              name="name"
              autoFocus
              defaultValue={
                modalState?.mode === "create"
                  ? modalState.defaultName
                  : modalState?.mode === "add-at"
                    ? modalState.defaultName
                    : (modalState?.currentName ?? "")
              }
              required
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={handleCancel} type="button">
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
