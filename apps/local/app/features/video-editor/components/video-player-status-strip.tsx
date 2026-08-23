import { formatSecondsToTimeCode } from "@/services/utils";
import { AlertTriangleIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { MissingWordTimingBadge } from "./transcript-word-actions";

/**
 * The one-line strip under the player: what this Video is, how long it runs,
 * and anything wrong with it that the whole Video (not one Clip) suffers from.
 *
 * Split out of video-player-panel.tsx, which is at the per-file token budget.
 */
export const VideoPlayerStatusStrip = () => {
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  const totalDuration = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.totalDuration
  );
  const areAnyClipsDangerous = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.areAnyClipsDangerous
  );

  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs text-muted-foreground">
        {videoTitle}
        {" · " + formatSecondsToTimeCode(totalDuration)}
      </span>
      {areAnyClipsDangerous && (
        <span className="text-orange-500 text-xs font-medium inline-flex items-center">
          <AlertTriangleIcon className="size-3.5 mr-1" />
          Possible duplicates
        </span>
      )}
      <MissingWordTimingBadge />
    </div>
  );
};
