import { createContext, useContext, type ReactNode } from "react";

/**
 * Ambient "show the Beat Description note" switch for an entire
 * {@link BeatList} subtree. Lets the Section Workbench turn descriptions on
 * for every Beat under it without threading a `showDescriptions` prop down
 * through SectionGrid → SectionCard → SortableLessonItem → LessonBeatTree.
 *
 * Defaults to `false`, so surfaces with no provider (the dense course view)
 * keep hiding the planning note. A BeatList prop still wins when passed
 * explicitly (the editor's Beats tab sets it directly).
 */
const BeatDescriptionsContext = createContext(false);

export function BeatDescriptionsProvider({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  return (
    <BeatDescriptionsContext.Provider value={show}>
      {children}
    </BeatDescriptionsContext.Provider>
  );
}

export function useShowBeatDescriptions() {
  return useContext(BeatDescriptionsContext);
}
