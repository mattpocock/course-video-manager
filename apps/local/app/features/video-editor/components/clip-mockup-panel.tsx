"use client";

import { Play } from "lucide-react";
import { ClipMockupList } from "@/features/clip-mockups/clip-mockup-list";
import { useClipMockups } from "@/features/clip-mockups/use-clip-mockups";

/**
 * The editor side slot's **Mockups** tab: this Video's Animatic, beside its
 * Beats and its Script. Self-contained in the same way {@link ScriptPanel} is
 * — it loads and writes through `/api/clip-mockup-editor` rather than being
 * threaded through the editor, because sixty lines of prose and sixty frame
 * URLs are of no use to the timeline.
 *
 * It holds one way into `/videos/:videoId/animatic`, beside the Clip Mockups it
 * plays. The editor's compact header and the Video header hold the same link,
 * for the author who is not already reading this tab. That route is
 * deliberately outside the app layout, so every way in is a plain anchor, never
 * a `Link`.
 */
export function ClipMockupPanel({ videoId }: { videoId: string }) {
  const {
    loaded,
    clipMockups,
    pending,
    failure,
    setLine,
    moveClipMockup,
    deleteClipMockup,
  } = useClipMockups(videoId);

  if (!loaded) {
    return (
      <div className="flex-1 p-4 text-sm text-muted-foreground">
        Loading Clip Mockups…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {clipMockups.length > 0 && (
        <a
          href={`/videos/${videoId}/animatic`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 self-start rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <Play className="w-3 h-3" />
          Watch the Animatic
        </a>
      )}
      <ClipMockupList
        clipMockups={clipMockups}
        pending={pending}
        failure={failure}
        onSetLine={setLine}
        onMove={moveClipMockup}
        onDelete={deleteClipMockup}
      />
    </div>
  );
}
