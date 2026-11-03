import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { stillRound } from "../cvm-recorder-reducer";
import { clipFrameRequest } from "../clip-frame-preview-reducer";
import type { ClipOverlay } from "../overlay-preview";
import { useClipFramePreview } from "../hooks/use-clip-frame-preview";

const NO_OVERLAYS: readonly ClipOverlay[] = [];

/**
 * Over the editor's player, on both Video Formats: paused or scrubbing, the
 * frame the Video's render shows there (a Short's post, a Landscape Video's
 * course export), drawn by the export's own code (the same as
 * `cvm clip frame`). Playing, nothing: the player draws the Clip, its Layers
 * and its Overlays. While a frame draws, or when it is refused, a note says
 * so over the player. `overlaysByClipId` is what the player draws, by Clip.
 */
export const ClipFramePreviewOverlay = (props: {
  overlaysByClipId: ReadonlyMap<string, ClipOverlay[]>;
}) => {
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
  const overlays =
    (clip && props.overlaysByClipId.get(clip.databaseId)) ?? NO_OVERLAYS;
  const request = useMemo(
    () =>
      clipFrameRequest({
        clip,
        overlays,
        runningState,
        scrubSeekTime,
        currentTimeInClip,
        round,
      }),
    [clip, overlays, runningState, scrubSeekTime, currentTimeInClip, round]
  );
  const preview = useClipFramePreview(request);

  return (
    <>
      {preview.image && (
        <img
          src={preview.image}
          alt="The frame the export shows here"
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
              ? "Drawing the export's frame…"
              : preview.message}
          </span>
        </div>
      )}
    </>
  );
};
