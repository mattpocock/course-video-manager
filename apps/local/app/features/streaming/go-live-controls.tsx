import { useEffect } from "react";
import { useContextSelector } from "use-context-selector";
import { RadioIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { useLiveStream } from "./live-stream-context";
import { goLiveControl } from "./live-stream-reducer";

/**
 * Go Live / End Stream: the Streaming tab's only main button, under the
 * picture, with the Live Stream's status and why a press was refused. The
 * Live Stream surface decides; this draws it and bridges the recorder's
 * word on the Live Stream in.
 */
export const GoLiveControls = () => {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const silenceLength = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.silenceLength
  );
  const stream = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state.stream
  );
  const { state, dispatch } = useLiveStream();

  // Bridges what the recorder says of the Live Stream in.
  useEffect(() => {
    dispatch({ type: "stream-status-heard", videoId, status: stream });
  }, [videoId, stream, dispatch]);

  const control = goLiveControl(state, videoId);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        {control.press === "go-live" ? (
          <Button
            disabled={control.busy}
            onClick={() =>
              dispatch({ type: "go-live-pressed", videoId, silenceLength })
            }
          >
            <RadioIcon className="size-4 mr-1" />
            Go Live
          </Button>
        ) : (
          <Button
            variant="destructive"
            disabled={control.busy}
            onClick={() => dispatch({ type: "end-stream-pressed", videoId })}
          >
            <SquareIcon className="size-4 mr-1" />
            End Stream
          </Button>
        )}
        {control.status && (
          <p className="text-sm text-muted-foreground" role="status">
            {control.status}
          </p>
        )}
      </div>
      {control.refusal && (
        <p className="text-sm text-destructive" role="alert">
          {control.refusal}
        </p>
      )}
    </div>
  );
};
