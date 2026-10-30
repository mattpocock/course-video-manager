import type { ReactNode } from "react";
import { Link } from "react-router";
import { useContextSelector } from "use-context-selector";
import {
  ChevronLeftIcon,
  MessageSquareIcon,
  MonitorSpeaker,
  VideoOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { teleprompterChannel } from "@/lib/teleprompter-protocol";
import { VideoEditorContext } from "@/features/video-editor/video-editor-context";
import { getHasLivePreview } from "@/features/video-editor/live-preview";
import { LivePreviewFrame } from "@/features/video-editor/components/live-preview-frame";
import { CvmRecorderControls } from "@/features/video-editor/components/cvm-recorder-controls";
import { StreamClipListView } from "./stream-clip-list-view";
import { BroadcastPicker } from "./broadcast-picker";
import { GoLiveControls } from "./go-live-controls";

/** The composite preview, or a frame saying there is none yet. */
const StreamPicture = () => {
  const hasLivePreview = useContextSelector(VideoEditorContext, (ctx) =>
    getHasLivePreview(ctx.cvmRecorder.state)
  );
  if (hasLivePreview) return <LivePreviewFrame />;
  return (
    <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
      <VideoOffIcon className="size-10 text-muted-foreground" />
      <p className="text-muted-foreground text-sm">
        No picture from the recorder yet.
      </p>
    </div>
  );
};

const TeleprompterLauncher = () => {
  const isOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isTeleprompterConnected
  );
  if (isOpen) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void teleprompterChannel.open()}
    >
      <MonitorSpeaker className="w-4 h-4 mr-1" />
      Teleprompter
    </Button>
  );
};

/**
 * The Streaming tab's layout, around the video editor's wiring: the
 * composite preview with the recorder's status and alerts on the left, chat
 * on the right, and below the compact Clip list beside the Script and
 * Suggestions (which feed the teleprompter).
 */
export const StreamingLayout = (props: { sidePanel: ReactNode }) => {
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );

  return (
    <div className="flex flex-col h-screen p-2 gap-2">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/streaming" aria-label="Pick another Video">
            <ChevronLeftIcon className="size-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-medium">Streaming · {videoTitle}</h1>
        <div className="ml-auto">
          <TeleprompterLauncher />
        </div>
      </header>
      <div className="flex flex-col lg:flex-row gap-2 min-h-0 lg:flex-[3]">
        <section className="lg:flex-[2] min-h-0 flex flex-col gap-1">
          {/* Fitted to the height left over, so the recorder's status and
              alerts below it are always in view. */}
          <div className="flex-1 min-h-0 flex justify-center">
            <div className="h-full max-w-full aspect-[16/9]">
              <StreamPicture />
            </div>
          </div>
          <div className="shrink-0 max-h-[40%] overflow-y-auto flex flex-col gap-2">
            <GoLiveControls />
            <CvmRecorderControls />
          </div>
        </section>
        <aside className="lg:w-[40ch] shrink-0 min-h-0 rounded-lg border bg-card/40 flex flex-col gap-3 p-3">
          <div className="shrink-0 max-h-[50%] flex flex-col min-h-0">
            <BroadcastPicker />
          </div>
          <div
            className="flex-1 flex flex-col items-center justify-center gap-2 text-center"
            data-testid="stream-chat"
          >
            <MessageSquareIcon className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              The Broadcast's live chat shows here.
            </p>
          </div>
        </aside>
      </div>
      <div className="flex flex-col lg:flex-row gap-2 min-h-0 lg:flex-[2]">
        <div className="flex-1 min-h-0">
          <StreamClipListView />
        </div>
        <div className="lg:w-[40ch] shrink-0 min-h-0">{props.sidePanel}</div>
      </div>
    </div>
  );
};
