import type { VideoAction } from "@/features/video-menu/video-menu";
import { NEW_SHORT_ACTION, newShortFormData } from "@/lib/new-short";
import { useFetcher } from "react-router";
import { useContextSelector } from "use-context-selector";
import { canStop, isCvmRecorderRecording } from "./cvm-recorder-reducer";
import { recorderStateOf } from "./cvm-recorder-machine";
import { VideoEditorContext } from "./video-editor-context";

/**
 * The editor's New Short: creates a Short and opens it, its back button
 * returning to this Video (`returnTo`). A take never outlives the editor
 * unsaved: a CVM recorder take is stopped first, as the Stop button stops it
 * (Footage closed, take kept).
 */
export function useNewShortAction(): VideoAction {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const cvmRecorder = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder
  );
  const fetcher = useFetcher();
  const isCreating = fetcher.state !== "idle";

  return {
    onSelect: () => {
      // Read as it is pressed: the menu item never re-renders for the recorder.
      const recorder = recorderStateOf(cvmRecorder.actor.getSnapshot());
      if (isCvmRecorderRecording(recorder) && canStop(recorder))
        cvmRecorder.onStop();
      void fetcher.submit(newShortFormData({ returnToVideoId: videoId }), {
        method: "post",
        action: NEW_SHORT_ACTION,
      });
    },
    disabled: isCreating,
    description: isCreating ? "Creating…" : undefined,
  };
}
