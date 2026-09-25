"use client";

import { ClipMockupList } from "@/features/clip-mockups/clip-mockup-list";
import { useClipMockups } from "@/features/clip-mockups/use-clip-mockups";

/**
 * The editor side slot's **Mockups** tab: this Video's Animatic, beside its
 * Beats and its Script. Self-contained in the same way {@link ScriptPanel} is
 * — it loads and writes through `/api/clip-mockup-editor` rather than being
 * threaded through the editor, because sixty lines of prose and sixty frame
 * URLs are of no use to the timeline.
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
    <ClipMockupList
      clipMockups={clipMockups}
      pending={pending}
      failure={failure}
      onSetLine={setLine}
      onMove={moveClipMockup}
      onDelete={deleteClipMockup}
    />
  );
}
