import { AlertTriangleIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { anyClipsMissingTranscriptWords } from "../transcript-word-status";
import { useClipStateSelector } from "../use-clip-state-selector";
import { VideoEditorContext } from "../video-editor-context";
import { getRetranscribableClipIds } from "../video-editor-selectors";

/**
 * The two places Transcript Words show up in the editor's chrome: the warning
 * that this Video has none, and the action that goes and gets them.
 *
 * Both are rendered by the landscape editor and by the portrait Studio, and
 * both read what they need out of the editor's context rather than taking it as
 * props — so the two callers share the wording AND the behaviour, and neither
 * can drift from the other by editing only one of them.
 */

/**
 * "Some Clips in this Video have no word-level timing."
 *
 * Renders nothing when every Clip has its Transcript Words, so a caller can
 * drop it into a row unconditionally.
 */
export const MissingWordTimingBadge = () => {
  const anyMissing = useClipStateSelector(anyClipsMissingTranscriptWords);

  if (!anyMissing) return null;

  return (
    <span
      className="text-amber-500 text-xs font-medium inline-flex items-center shrink-0"
      title="Clips transcribed before word-level timing existed are never backfilled. Run 'Re-transcribe All Clips' from the Actions menu to add it."
    >
      <AlertTriangleIcon className="size-3.5 mr-1" />
      Missing word timing
    </span>
  );
};

/**
 * "Re-transcribe All Clips" — the backfill for the badge above (#1571),
 * scoped to this Video rather than the whole library. The Actions menu offers
 * it in both editors.
 */
export const useRetranscribeAllClips = () => {
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );

  return () =>
    dispatch({
      type: "retranscribe-clips",
      clipIds: getRetranscribableClipIds(clips),
    });
};
