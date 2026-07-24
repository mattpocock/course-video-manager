"use client";

import { WritableField } from "@/features/article-writer/writable-field";
import { useVideoScript } from "../hooks/use-video-script";

/**
 * The editor side slot's **Script** tab: this video's teleprompter script as a
 * full WritableField (inline Monaco + preview + "Open in writer"). Self-
 * contained — it loads and persists via {@link useVideoScript} rather than
 * threading script + writer context through the editor. The Script field
 * carries no AI modes yet (course-video-manager#1421), so the writer is a
 * manual editing surface for now.
 */
export function ScriptPanel({ videoId }: { videoId: string }) {
  const { loaded, script, context, persistScript } = useVideoScript(videoId);

  if (!loaded || !context) {
    return (
      <div className="flex-1 p-4 text-sm text-muted-foreground">
        Loading script…
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 p-3">
      <WritableField
        videoId={videoId}
        fieldId="video-script"
        value={script}
        onChange={persistScript}
        onApply={persistScript}
        context={context}
        modes={[]}
        placeholder="Write the teleprompter script for this video…"
        height={480}
      />
    </div>
  );
}
