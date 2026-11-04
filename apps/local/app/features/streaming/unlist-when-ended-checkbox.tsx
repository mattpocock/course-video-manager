import { useEffect } from "react";
import { useContextSelector } from "use-context-selector";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { useLiveStream } from "./live-stream-context";
import { unlistWhenEndedOf } from "./unlist-when-ended";

/**
 * The **Unlist When Ended** checkbox for the Video the Streaming tab is open
 * for. Its callers show it only for a public Broadcast: beside the picked
 * one, and in the New Broadcast form when Public is picked.
 */
export const UnlistWhenEndedCheckbox = (props: { id: string }) => {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const { state, dispatch } = useLiveStream();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={props.id}
        checked={unlistWhenEndedOf(state, videoId)}
        onCheckedChange={(checked) =>
          dispatch({
            type: "unlist-when-ended-toggled",
            videoId,
            checked: checked === true,
          })
        }
      />
      <Label htmlFor={props.id} className="text-sm font-normal">
        Unlist when the stream ends
      </Label>
    </div>
  );
};

/** Bridges the Streaming tab's mount to the surface, which reads the Video's choice. */
export const useStreamingTabShown = (videoId: string) => {
  const { dispatch } = useLiveStream();
  useEffect(() => {
    dispatch({ type: "streaming-tab-shown", videoId });
  }, [dispatch, videoId]);
};
