"use client";

import { WriterModal } from "@/features/article-writer/writer-modal";
import { useVideoScript } from "./hooks/use-video-script";

/**
 * Opens the full Writer on a video's Script from anywhere (course-view context
 * menu, video-editor actions), loading the script + writer context on demand
 * via {@link useVideoScript} (gated on `open`, so each open starts fresh).
 * Mount conditionally. Mirrors {@link LessonBodyWriterModal}; the Script field
 * carries no AI modes yet (course-video-manager#1421), so this is a manual
 * editing surface for now.
 */
export function ScriptWriterModal({
  videoId,
  open,
  onOpenChange,
}: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { script, context, persistScript } = useVideoScript(videoId, open);

  return (
    <WriterModal
      open={open}
      onOpenChange={onOpenChange}
      videoId={videoId}
      fieldId="video-script"
      modes={[]}
      value={script}
      context={context}
      onApply={persistScript}
    />
  );
}
