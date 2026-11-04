import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThumbnailSelector } from "@/features/video-posting/post-page-thumbnail-selector";
import {
  broadcastThumbnailReport,
  canSetThumbnail,
} from "./broadcast-thumbnail-reducer";
import { ReportRow } from "./new-broadcast-form";
import type { NewBroadcastVideo } from "./new-stream-video";
import { useBroadcastThumbnailReducer } from "./use-new-broadcast-reducer";

/**
 * The picked Broadcast's thumbnail: a button beside it that opens the
 * Video's thumbnails, to set or change the Broadcast's before or during the
 * Live Stream. It says when the thumbnail could not be set.
 */
export const BroadcastThumbnailControl = (props: {
  broadcastId: string;
  video: NewBroadcastVideo;
}) => {
  const [state, dispatch] = useBroadcastThumbnailReducer(props.video);
  const report = broadcastThumbnailReport(state, props.broadcastId);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => dispatch({ type: "thumbnail-clicked" })}
      >
        <ImageIcon className="size-4 mr-1" />
        Thumbnail
      </Button>
      <Dialog
        open={state.open}
        onOpenChange={(open) => !open && dispatch({ type: "picker-dismissed" })}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Broadcast thumbnail</DialogTitle>
            <DialogDescription>
              Sets one of the Video's thumbnails on the picked Broadcast. It can
              be changed while live.
            </DialogDescription>
          </DialogHeader>
          <ThumbnailSelector
            videoId={props.video.id}
            thumbnails={props.video.thumbnails}
            selectedThumbnailId={state.thumbnailId}
            onSelectThumbnail={(thumbnailId) =>
              dispatch({ type: "thumbnail-picked", thumbnailId })
            }
          />
          {report !== null && <ReportRow line={report} />}
          <DialogFooter>
            <Button
              disabled={!canSetThumbnail(state)}
              onClick={() =>
                dispatch({
                  type: "set-clicked",
                  broadcastId: props.broadcastId,
                })
              }
            >
              {state.setting ? "Setting…" : "Set thumbnail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
