import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { stillRound } from "../cvm-recorder-reducer";
import { shortFrameRequest } from "../short-frame-preview-reducer";
import { useShortFramePreview } from "../hooks/use-short-frame-preview";

/**
 * Over the Portrait Studio's player: paused or scrubbing, the frame the
 * Short's post shows there, drawn by the export's own code (the same as
 * `cvm clip frame`). Playing, nothing: the player draws the Clip, its
 * Footage Layers and its Chat Cards. While a frame draws, or when it is
 * refused, a note says so over the player.
 */
export const ShortFramePreviewOverlay = () => {
  const currentClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClip
  );
  const runningState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.runningState
  );
  const scrubSeekTime = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.scrubSeekTime
  );
  const currentTimeInClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentTimeInClip
  );
  const round = useContextSelector(VideoEditorContext, (ctx) =>
    stillRound(ctx.cvmRecorder.state)
  );

  const clip = currentClip?.type === "on-database" ? currentClip : undefined;
  const request = useMemo(
    () =>
      shortFrameRequest({
        clip,
        runningState,
        scrubSeekTime,
        currentTimeInClip,
        round,
      }),
    [clip, runningState, scrubSeekTime, currentTimeInClip, round]
  );
  const preview = useShortFramePreview(request);

  return (
    <>
      {preview.image && (
        <img
          src={preview.image}
          alt="The frame the post shows here"
          className="absolute inset-0 z-20 h-full w-full object-contain pointer-events-none"
        />
      )}
      {(preview.status === "drawing" ||
        preview.status === "held" ||
        preview.status === "failed") && (
        <div className="absolute top-2 inset-x-2 z-30 flex justify-center pointer-events-none">
          <span className="rounded bg-black/70 px-2 py-1 text-xs text-white flex items-center gap-1">
            {preview.status === "drawing" && (
              <Loader2 className="size-3 animate-spin" />
            )}
            {preview.status === "drawing"
              ? "Drawing the post's frame…"
              : preview.message}
          </span>
        </div>
      )}
    </>
  );
};
