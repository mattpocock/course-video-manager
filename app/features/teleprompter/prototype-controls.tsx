/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * A raw readout of what the editor actually said, so a display showing nothing
 * can be told apart from a channel carrying nothing.
 *
 * Deliberately loud and ugly: it must not be mistaken for part of the design
 * being judged. Hidden in production builds so a stray merge can't ship it.
 *
 * The freeze toggle that used to live here is gone. Holding the display until
 * silence suppressed the dot appearing as the indicator turns green, which is
 * the one moment this display exists to show.
 */
import type { UnresolvedClips } from "@/lib/teleprompter-protocol";

const isProduction = import.meta.env.PROD;

export function PrototypeControls(props: { unresolved: UnresolvedClips }) {
  if (isProduction) return null;

  const counts = props.unresolved.reduce<Record<string, number>>(
    (acc, state) => ({ ...acc, [state]: (acc[state] ?? 0) + 1 }),
    {}
  );

  return (
    <div className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-full border-2 border-fuchsia-500 bg-fuchsia-950/95 px-3 py-1.5 font-mono text-xs tabular-nums text-fuchsia-100 shadow-lg">
      pending {counts.pending ?? 0} · orphaned {counts.orphaned ?? 0} · deleted{" "}
      {counts.deleted ?? 0}
    </div>
  );
}
