import { useContextSelector } from "use-context-selector";
import { useSelector, type EffectStore } from "@/hooks/effect-store";
import type { clipStateReducer } from "./clip-state-reducer";
import { VideoEditorContext } from "./video-editor-context";

/** The clip reducer's store: the Video's Clips, Chapters and Sessions. */
export type ClipStore = EffectStore<
  clipStateReducer.State,
  clipStateReducer.Action
>;

/**
 * A slice of the editor's clip reducer, by one of its selectors
 * (`transcript-word-status.ts`, `video-editor-selectors.ts`). The component
 * re-renders only when the slice changes, never for the rest of the clip
 * state. A selector that builds an object passes an `isEqual`.
 */
export const useClipStateSelector = <T>(
  selector: (state: clipStateReducer.State) => T,
  isEqual?: (a: T, b: T) => boolean
): T => {
  const store = useContextSelector(VideoEditorContext, (ctx) => ctx.clipStore);
  return useSelector(store, selector, isEqual);
};

/**
 * Two lists hold the same entries, in order. The clip reducer may rebuild
 * `items` or `sessions` without changing an entry (`[...state.items]` for a
 * save that brought no Clips), and a component that shows the list has
 * nothing new to render then.
 */
export const sameElements = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((entry, i) => Object.is(entry, b[i]));
