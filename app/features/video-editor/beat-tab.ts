/**
 * The two occupants of the editor's tabbed side slot. The Beats tab shows
 * *this video's own* plan; the Reference tab shows the sibling-video reader.
 * They merely share screen real estate — "Reference" stays reserved for the
 * sibling reader, never the beat view.
 */
export type BeatTab = "beats" | "reference";

/**
 * Resolve which tab the editor's side slot should show, given the persisted
 * choice and which tabs currently exist. Pure and total so it can be unit
 * tested independently of React:
 *
 *  - Honour the persisted tab if it still exists.
 *  - Otherwise default to Reference when one is selected, else Beats.
 *  - If neither tab exists, return `null` (fall back to two-column layout).
 */
export const resolveBeatTab = ({
  persistedTab,
  hasBeats,
  hasReference,
}: {
  persistedTab: BeatTab | null;
  hasBeats: boolean;
  hasReference: boolean;
}): BeatTab | null => {
  const exists = (tab: BeatTab): boolean =>
    tab === "beats" ? hasBeats : hasReference;

  if (persistedTab !== null && exists(persistedTab)) return persistedTab;

  if (hasReference) return "reference";
  if (hasBeats) return "beats";
  return null;
};
