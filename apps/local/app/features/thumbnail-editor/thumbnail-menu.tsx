import { useConfirmDelete } from "@/components/confirm-delete-dialog";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { toast } from "@/components/ui/toast";

const imageUrl = (thumbnailId: string) =>
  `/api/thumbnails/${thumbnailId}/image`;

async function copyImage(thumbnailId: string) {
  try {
    const res = await fetch(`/api/thumbnails/${thumbnailId}/image`);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    toast("Thumbnail image copied to clipboard");
  } catch {
    toast.error("Failed to copy thumbnail image to clipboard");
  }
}

function download(thumbnailId: string) {
  const a = document.createElement("a");
  a.href = imageUrl(thumbnailId);
  a.download = `thumbnail-${thumbnailId}.png`;
  a.click();
}

/**
 * A Thumbnail's actions, the same on the Thumbnails page and the post page's
 * selector. `onEdit` is the surface's own way in (load it into the editor,
 * or go to the Thumbnails page). Deleting removes the image files for good,
 * so it confirms first; render `deleteDialog` once beside the menus.
 */
export function useThumbnailMenu({
  onEdit,
  onDelete,
}: {
  onEdit: (thumbnailId: string) => void;
  /** Absent where the surface only picks a Thumbnail: no Delete then. */
  onDelete?: (thumbnailId: string) => void;
}) {
  const confirmDelete = useConfirmDelete<string>({
    title: "Delete Thumbnail",
    description: () =>
      "Delete this Thumbnail and its image files? This cannot be undone.",
    onConfirm: (thumbnailId) => onDelete?.(thumbnailId),
  });

  const groupsFor = (thumbnail: {
    id: string;
    /** It has been rendered to an image, so there is something to copy or download. */
    hasImage: boolean;
  }): ActionMenuGroups => ({
    edit: [{ ...STANDARD_ACTIONS.edit, onSelect: () => onEdit(thumbnail.id) }],
    run: [
      thumbnail.hasImage && {
        ...STANDARD_ACTIONS.export,
        label: "Download",
        onSelect: () => download(thumbnail.id),
      },
    ],
    copy: [
      thumbnail.hasImage && {
        ...STANDARD_ACTIONS.copy,
        label: "Copy Image",
        onSelect: () => void copyImage(thumbnail.id),
      },
    ],
    danger: [
      onDelete !== undefined && {
        ...STANDARD_ACTIONS.delete,
        opensDialog: true,
        onSelect: () => confirmDelete.request(thumbnail.id),
      },
    ],
  });

  return { groupsFor, deleteDialog: confirmDelete.dialog };
}
