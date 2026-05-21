"use client";

import { Link } from "react-router";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function ThumbnailSelector({
  videoId,
  thumbnails,
  selectedThumbnailId,
  onSelectThumbnail,
  onDeleteThumbnail,
}: {
  videoId: string;
  thumbnails: Array<{ id: string }>;
  selectedThumbnailId: string | null;
  onSelectThumbnail: (id: string | null) => void;
  onDeleteThumbnail: (id: string) => void;
}) {
  const handleToggle = (thumbnailId: string) => {
    onSelectThumbnail(thumbnailId === selectedThumbnailId ? null : thumbnailId);
  };

  return (
    <div className="space-y-2">
      <Label>Thumbnail</Label>
      {thumbnails.length === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground">
          <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No thumbnails created yet.</p>
          <Button variant="outline" size="sm" className="mt-2" asChild>
            <Link to={`/videos/${videoId}/thumbnails`}>
              <PlusIcon className="h-4 w-4" />
              Add New Thumbnail
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {thumbnails.map((thumbnail) => {
              const isSelected = thumbnail.id === selectedThumbnailId;
              return (
                <ContextMenu key={thumbnail.id}>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => handleToggle(thumbnail.id)}
                      className={`cursor-context-menu relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                        isSelected
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-transparent hover:border-muted-foreground/30"
                      }`}
                    >
                      <img
                        src={`/api/thumbnails/${thumbnail.id}/image`}
                        alt="Thumbnail"
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
                          <CheckIcon className="h-3 w-3" />
                        </div>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={async () => {
                        try {
                          const res = await fetch(
                            `/api/thumbnails/${thumbnail.id}/image`
                          );
                          const blob = await res.blob();
                          await navigator.clipboard.write([
                            new ClipboardItem({ [blob.type]: blob }),
                          ]);
                          toast("Copied to clipboard");
                        } catch {
                          toast.error("Failed to copy to clipboard");
                        }
                      }}
                    >
                      <ClipboardIcon className="size-4" />
                      Copy to clipboard
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = `/api/thumbnails/${thumbnail.id}/image`;
                        a.download = `thumbnail-${thumbnail.id}.png`;
                        a.click();
                      }}
                    >
                      <DownloadIcon className="size-4" />
                      Download
                    </ContextMenuItem>
                    <ContextMenuItem asChild>
                      <Link to={`/videos/${videoId}/thumbnails`}>
                        <PencilIcon className="size-4" />
                        Edit
                      </Link>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => onDeleteThumbnail(thumbnail.id)}
                    >
                      <Trash2Icon className="size-4" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/videos/${videoId}/thumbnails`}>
              <PlusIcon className="h-4 w-4" />
              Add New Thumbnail
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
