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

/**
 * Modal dialog for creating, editing, or adding chapters.
 *
 * Supports three modes:
 * - create: Creates a new section at the end
 * - edit: Renames an existing section
 * - add-at: Creates a new section before/after a specific item
 *
 * When dismissed or cancelled, no section is created.
 *
 * @example
 * <ChapterNamingModal
 *   modalState={chapterNamingModal}
 *   onClose={() => setChapterNamingModal(null)}
 *   onAddChapter={handleAddChapter}
 *   onUpdateChapter={handleUpdateChapter}
 *   onAddChapterAt={handleAddChapterAt}
 * />
 */
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
              ? "Name Clip Section"
              : modalState?.mode === "add-at"
                ? "Name Clip Section"
                : "Edit Clip Section"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4 py-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="clip-section-name">Section Name</Label>
            <Input
              id="clip-section-name"
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
