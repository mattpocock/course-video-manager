import { createContext, useContext, type ReactNode } from "react";

/**
 * Ambient "show the Beat Description note" switch for an entire
 * {@link BeatList} subtree, for a caller that wants every Beat under it
 * showing its note without threading a `showDescriptions` prop down through
 * every intermediate component. Currently unused end-to-end: the course
 * view and Section Workbench (the SectionGrid → SectionCard →
 * SortableLessonItem → LessonBeatTree chain) both pass `showDescriptions`
 * explicitly instead, reading Course View Display Settings — see
 * `lesson-beat-tree.tsx` — which always wins over this ambient default.
 *
 * Defaults to `false`, so a surface with no provider keeps hiding the
 * planning note. A BeatList prop still wins when passed explicitly (the
 * editor's Beats tab sets it directly).
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
