/**
 * The three occupants of the editor's tabbed side slot. The Beats tab shows
 * *this video's own* plan; the Reference tab shows the sibling-video reader;
 * the Script tab shows this video's teleprompter script. They merely share
 * screen real estate — "Reference" stays reserved for the sibling reader,
 * never the beat or script view.
 */
export type BeatTab = "beats" | "reference" | "script";

/**
 * Resolve which tab the editor's side slot should show, given the persisted
 * choice and which tabs currently exist. Pure and total so it can be unit
 * tested independently of React:
 *
 *  - Honour the persisted tab if it still exists.
 *  - Otherwise Script. It always exists (you author the script there, empty or
 *    not), it's what the teleprompter mirrors, and it's what you're in front of
 *    for most of a session. Reference and Beats are still selected outright by
 *    the actions that open them — adding a reference, or jumping to a beat —
 *    they're just not what an unopened video falls back to.
 */
export const resolveBeatTab = ({
  persistedTab,
  hasBeats,
  hasReference,
}: {
  persistedTab: BeatTab | null;
  hasBeats: boolean;
  hasReference: boolean;
}): BeatTab => {
  const exists = (tab: BeatTab): boolean => {
    if (tab === "beats") return hasBeats;
    if (tab === "reference") return hasReference;
    return true; // the Script tab is always available
  };

  if (persistedTab !== null && exists(persistedTab)) return persistedTab;

  return "script";
};
