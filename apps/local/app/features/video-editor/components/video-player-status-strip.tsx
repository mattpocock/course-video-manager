import { formatSecondsToTimeCode } from "@/services/utils";
import { AlertTriangleIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";

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
  const anyClipsMissingTranscriptWords = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.anyClipsMissingTranscriptWords
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
      {anyClipsMissingTranscriptWords && (
        <span
          className="text-amber-500 text-xs font-medium inline-flex items-center"
          title="Clips transcribed before word-level timing existed are never backfilled. Run 'Re-transcribe all clips' from the Actions menu to add it."
        >
          <AlertTriangleIcon className="size-3.5 mr-1" />
          Missing word timing
        </span>
      )}
    </div>
  );
};
