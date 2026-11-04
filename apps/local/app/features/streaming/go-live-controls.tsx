import { useContextSelector } from "use-context-selector";
import { RadioIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { useLiveStream } from "./live-stream-context";
import { goLiveControl, liveSinceOf } from "./live-stream-reducer";
import { LiveTimer } from "./live-timer";
import { streamHealthAmber, streamHealthLine } from "./stream-health-line";

/**
 * Go Live / End Stream: the Streaming tab's main button, in its toolbar
 * beside the Teleprompter (#2558), with the Live Timer before it while live.
 * The Live Stream surface decides, from the app server's word on the Live
 * Stream.
 */
export const GoLiveButton = () => {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const silenceLength = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.silenceLength
  );
  const { state, dispatch } = useLiveStream();
  const control = goLiveControl(state, videoId);
  const button =
    control.press === "go-live" ? (
      <Button
        size="sm"
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
        size="sm"
        variant="destructive"
        disabled={control.busy}
        onClick={() => dispatch({ type: "end-stream-pressed", videoId })}
      >
        <SquareIcon className="size-4 mr-1" />
        End Stream
      </Button>
    );
  return (
    <>
      <LiveTimer
        liveSince={liveSinceOf(state, videoId)}
        className="font-mono text-sm tabular-nums text-red-600"
      />
      {button}
    </>
  );
};

/**
 * What the Live Stream is doing, under the picture: its status, its health
 * line and why a press was refused. The health line also reads this tab's
 * recorder. Nothing at all before the first Go Live.
 */
export const GoLiveStatus = () => {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const health = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state.streamHealth
  );
  const { state } = useLiveStream();

  const control = goLiveControl(state, videoId);
  const healthLine = streamHealthLine(state, videoId, health);
  if (!control.status && !healthLine && !control.refusal) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      {control.status && (
        <p className="text-sm text-muted-foreground" role="status">
          {control.status}
        </p>
      )}
      {healthLine && (
        <p
          className={cn(
            "text-xs tabular-nums",
            streamHealthAmber(health)
              ? "text-amber-600"
              : "text-muted-foreground"
          )}
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
