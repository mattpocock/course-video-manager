import { useSelector } from "@xstate/react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "./video-editor-context";
import { recorderStateOf } from "./cvm-recorder-machine";
import type { cvmRecorderReducer } from "./cvm-recorder-reducer";

/**
 * A slice of the editor's CVM recorder, by one of its selectors
 * (`cvm-recorder-reducer.ts`). The component re-renders only when the slice
 * changes, never for the rest of the recorder.
 */
export const useCvmRecorderSelector = <T>(
  selector: (state: cvmRecorderReducer.State) => T
): T => {
  const actor = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.actor
  );
  return useSelector(actor, (snapshot) => selector(recorderStateOf(snapshot)));
};
