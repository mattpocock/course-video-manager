import type { ComponentProps, ReactNode } from "react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { EditorCompactHeader } from "./editor-compact-header";
import { ClipTimeline } from "./clip-timeline";
import { VideoPlayerPanel } from "./video-player-panel";
import { PortraitStudioPanel } from "./portrait-studio-panel";

/**
 * The edit route's layout: the compact header over three columns, the Clip
 * timeline, the side panel and the player. A Short gets the Shorts studio in
 * the player's place.
 */
export const EditorLayout = (props: {
  /** The header's breadcrumb and tabs; none outside a Video's route. */
  navigation: ComponentProps<typeof EditorCompactHeader> | undefined;
  sidePanel: ReactNode;
}) => {
  const isShort = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoFormat === "short"
  );

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      {props.navigation && <EditorCompactHeader {...props.navigation} />}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-2">
        <ClipTimeline />
        {/* The Script tab is always available, so the side slot always
            renders (three columns): timeline, side panel, player. */}
        <div className="order-3 lg:order-2 lg:w-[40ch] shrink-0 h-full min-h-0">
          {props.sidePanel}
        </div>
        <div className="order-1 lg:order-3 lg:flex-[1.5] h-full min-h-0 flex flex-col">
          {isShort ? <PortraitStudioPanel /> : <VideoPlayerPanel />}
        </div>
      </div>
    </div>
  );
};
