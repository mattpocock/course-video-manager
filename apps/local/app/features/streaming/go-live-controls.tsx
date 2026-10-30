import { useEffect } from "react";
import { useContextSelector } from "use-context-selector";
import { RadioIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { useLiveStream } from "./live-stream-context";
import { goLiveControl } from "./live-stream-reducer";
import { streamHealthLine } from "./stream-health-line";

/**
 * Go Live / End Stream: the Streaming tab's only main button, under the
 * picture, with the Live Stream's status, its health line and why a press
 * was refused. The
 * Live Stream surface decides; this draws it and bridges the recorder's
 * word on the Live Stream and its health in.
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
  const health = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state.streamHealth
  );
  const { state, dispatch } = useLiveStream();

  // Bridges what the recorder says of the Live Stream in.
  useEffect(() => {
    dispatch({ type: "stream-status-heard", videoId, status: stream });
  }, [videoId, stream, dispatch]);
  useEffect(() => {
    if (health) dispatch({ type: "stream-health-heard", videoId, health });
  }, [videoId, health, dispatch]);

  const control = goLiveControl(state, videoId);
  const healthLine = streamHealthLine(state, videoId);
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
      {healthLine && (
        <p
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="stream-health"
        >
          {healthLine}
        </p>
      )}
      {control.refusal && (
        <p className="text-sm text-destructive" role="alert">
          {control.refusal}
        </p>
      )}
    </div>
  );
};
