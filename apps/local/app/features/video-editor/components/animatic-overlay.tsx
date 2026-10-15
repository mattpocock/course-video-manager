import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import { useContextSelector } from "use-context-selector";
import { AnimaticCommentsProvider } from "@/features/animatic/animatic-comments";
import { AnimaticPlayer } from "@/features/animatic/animatic-player";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";
import type { loader as animaticLoader } from "@/routes/_app.videos.$videoId.animatic";
import { VideoEditorContext } from "../video-editor-context";

/**
 * The Animatic player OVER the Video Editor, opened by a click on a Clip
 * Mockup in the side panel's Animatic tab and playing from it.
 *
 * THE ANIMATIC PAGE'S OWN PLAYER, fed by the Animatic page's own loader
 * through a fetcher, so the two can never disagree about a missing file, a
 * Chapter, a comment or the Section clock.
 *
 * A PLAIN OVERLAY, NOT A DIALOG. Both pages' shortcut guard ignores every key
 * from inside a `role="dialog"`, which would leave the player's keys dead.
 * The editor's own keys are kept off by the editor's reducer instead, which
 * drops them while this is open (`videoStateReducer.State["animatic"]`). ESC
 * — the player's key — closes it, and so does the button.
 *
 * Mounted by the Animatic tab, and drawn into `document.body` so no box of
 * the side panel can clip it.
 */
export function AnimaticOverlay() {
  const owner = useContextSelector(VideoEditorContext, (c) => c.animatic);
  const videoId = useContextSelector(VideoEditorContext, (c) => c.videoId);
  const dispatch = useContextSelector(VideoEditorContext, (c) => c.dispatch);
  if (!owner) return null;
  return createPortal(
    <OpenAnimatic
      videoId={videoId}
      clipMockupId={owner.clipMockupId}
      onClose={() => dispatch({ type: "dismiss-animatic" })}
    />,
    document.body
  );
}

function OpenAnimatic(props: {
  videoId: string;
  clipMockupId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher<typeof animaticLoader>();

  // A bridge, not a decision: load the Animatic once, for this Video.
  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(`/videos/${props.videoId}/animatic`);
    }
  }, [props.videoId, fetcher]);

  const data = fetcher.data;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      aria-label="Animatic"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-semibold">Animatic</span>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close the Animatic (Esc)"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {data ? (
          <AnimaticCommentsProvider comments={data.comments}>
            <AnimaticPlayer
              mockups={data.mockups}
              chapters={data.chapters}
              sectionRunTime={data.sectionRunTime}
              width={VIDEO_FORMAT_DIMENSIONS[data.video.format].width}
              height={VIDEO_FORMAT_DIMENSIONS[data.video.format].height}
              startAt={props.clipMockupId}
              onClose={props.onClose}
            />
          </AnimaticCommentsProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading the Animatic…
          </div>
        )}
      </div>
    </div>
  );
}
