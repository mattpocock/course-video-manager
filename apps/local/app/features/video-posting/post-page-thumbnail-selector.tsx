("use client");

import { Link, useNavigate } from "react-router";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckIcon, ImageIcon, PlusIcon } from "lucide-react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { useThumbnailMenu } from "@/features/thumbnail-editor/thumbnail-menu";

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
  /** Absent where Thumbnails are only picked (a Broadcast's): no Delete. */
  onDeleteThumbnail?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const thumbnailMenu = useThumbnailMenu({
    onEdit: () => navigate(`/videos/${videoId}/thumbnails`),
    onDelete: onDeleteThumbnail,
  });

  const handleToggle = (thumbnailId: string) => {
    onSelectThumbnail(thumbnailId === selectedThumbnailId ? null : thumbnailId);
  };

  return (
    <div className="space-y-2">
      <Label>Thumbnail</Label>
      {thumbnailMenu.deleteDialog}
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
                  <EntityMenuContent
                    menu="context"
                    entity={{ type: "thumbnail", id: thumbnail.id, videoId }}
                    groups={thumbnailMenu.groupsFor({
                      id: thumbnail.id,
                      hasImage: true,
                    })}
                  />
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
