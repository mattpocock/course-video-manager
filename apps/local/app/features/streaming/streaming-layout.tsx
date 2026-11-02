import { Link } from "react-router";
import { useContextSelector } from "use-context-selector";
import {
  ChevronLeftIcon,
  ExternalLinkIcon,
  MonitorSpeaker,
  VideoOffIcon,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { teleprompterChannel } from "@/lib/teleprompter-protocol";
import { diagramChannel } from "@/lib/diagram-protocol";
import { streamChatChannel } from "@/lib/stream-chat-protocol";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { getHasLivePreview } from "@/features/video-editor/live-preview";
import { LivePreviewFrame } from "@/features/video-editor/components/live-preview-frame";
import { CvmRecorderControls } from "@/features/video-editor/components/cvm-recorder-controls";
import { useDiagramPlaygroundLauncher } from "@/features/video-editor/editor-video-menu";
import { usePopupOpen } from "@/features/video-editor/hooks/use-popup-open";
import { BroadcastPicker } from "./broadcast-picker";
import { GoLiveButton, GoLiveStatus } from "./go-live-controls";
import {
  BroadcastChatView,
  useBroadcastChatBridge,
} from "./broadcast-chat-view";
import { StreamCardPreview } from "./stream-card-preview";

/**
 * The composite preview, with the Chat Highlight the stream shows over it,
 * or a frame saying there is no picture yet.
 */
const StreamPicture = () => {
  const hasLivePreview = useContextSelector(VideoEditorContext, (ctx) =>
    getHasLivePreview(ctx.cvmRecorder.state)
  );
  if (hasLivePreview)
    return (
      <div className="relative">
        <LivePreviewFrame />
        <StreamCardPreview />
      </div>
    );
  return (
    <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
      <VideoOffIcon className="size-10 text-muted-foreground" />
      <p className="text-muted-foreground text-sm">
        No picture from the recorder yet.
      </p>
    </div>
  );
};

/**
 * The Streaming tab's toolbar, its every button in one place (#2558): Go
 * Live beside the Teleprompter, then the Diagram Playground and the pop-out
 * chat. Each popup's launcher shows only while its popup is closed.
 */
const StreamToolbar = () => {
  const isTeleprompterOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isTeleprompterConnected
  );
  const isDiagramPlaygroundOpen = usePopupOpen(diagramChannel);
  const isChatPoppedOut = usePopupOpen(streamChatChannel);
  const openDiagramPlayground = useDiagramPlaygroundLauncher();
  return (
    <div
      className="ml-auto flex items-center gap-2"
      data-testid="stream-toolbar"
    >
      <GoLiveButton />
      {!isTeleprompterOpen && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void teleprompterChannel.open()}
        >
          <MonitorSpeaker className="w-4 h-4 mr-1" />
          Teleprompter
        </Button>
      )}
      {!isDiagramPlaygroundOpen && (
        <Button variant="secondary" size="sm" onClick={openDiagramPlayground}>
          <Workflow className="w-4 h-4 mr-1" />
          Diagram Playground
        </Button>
      )}
      {!isChatPoppedOut && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => streamChatChannel.open()}
        >
          <ExternalLinkIcon className="w-4 h-4 mr-1" />
          Pop out chat
        </Button>
      )}
    </div>
  );
};

/**
 * The Streaming tab's layout, around the video editor's wiring: the toolbar
 * in the header, the composite preview with the Live Stream's and the
 * recorder's status and alerts under it, and the Broadcast and its chat
 * beside it. The Clips and the Script are the teleprompter's to show, so
 * the editor's side panel is not placed here (#2558).
 */
export const StreamingLayout = (props: {
  /** Why Chat Highlights can't be shown, if they can't (`chatHighlightsUnavailable`). */
  highlightsUnavailable: string | null;
}) => {
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  // The chat is heard while this tab is open, popped out or not.
  useBroadcastChatBridge();

  return (
    <div className="flex flex-col h-screen p-2 gap-2">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/streaming" aria-label="Pick another Video">
            <ChevronLeftIcon className="size-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-medium truncate">
          Streaming · {videoTitle}
        </h1>
        <StreamToolbar />
      </header>
      <div className="flex flex-col lg:flex-row gap-2 min-h-0 flex-1">
        <section className="lg:flex-1 min-h-0 flex flex-col gap-1">
          {/* Fitted to the height left over, so the status and alerts
              below it are always in view. */}
          <div className="flex-1 min-h-0 flex justify-center">
            <div className="h-full max-w-full aspect-[16/9]">
              <StreamPicture />
            </div>
          </div>
          <div className="shrink-0 max-h-[40%] overflow-y-auto flex flex-col gap-2">
            <GoLiveStatus />
            <CvmRecorderControls quiet />
          </div>
        </section>
        <aside className="lg:w-[48ch] shrink-0 min-h-0 rounded-lg border bg-card/40 flex flex-col gap-3 p-3">
          <div className="shrink-0 max-h-[50%] flex flex-col min-h-0">
            <BroadcastPicker />
          </div>
          <BroadcastChatView
            highlightsUnavailable={props.highlightsUnavailable}
          />
        </aside>
      </div>
    </div>
  );
};
