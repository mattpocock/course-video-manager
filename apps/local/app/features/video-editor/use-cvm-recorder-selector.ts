import { useContextSelector } from "use-context-selector";
import { useSelector } from "@/hooks/effect-store";
import type { cvmRecorderReducer } from "./cvm-recorder-reducer";
import { VideoEditorContext } from "./video-editor-context";

/**
 * A slice of the editor's CVM recorder, by one of its selectors
 * (`cvm-recorder-reducer.ts`, `cvm-recorder-screen.ts`, `live-preview.ts`).
 * The component re-renders only when the slice changes, never for the rest
 * of the recorder. A selector that builds an object passes an `isEqual`.
 */
export const useCvmRecorderSelector = <T>(
  selector: (state: cvmRecorderReducer.State) => T,
  isEqual?: (a: T, b: T) => boolean
): T => {
  const store = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.store
  );
  return useSelector(store, selector, isEqual);
};
