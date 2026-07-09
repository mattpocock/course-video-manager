// PROTOTYPE — wayfinder #135. Variant A: reflow-in-place grouped rows.
//
// Design answers this variant embodies:
//   - Placement: search box sits INLINE in the header, right of the "Diagrams"
//     title. One box, always visible; the grid lives directly under it.
//   - Composition: ONE box absorbs the old name filter — it searches name AND
//     content in a single field (no separate name input, no mode toggle).
//   - No query  -> the normal diagram grid (resting state unchanged).
//   - Query     -> grid is REPLACED by a vertical stack of per-diagram groups;
//     each group is the diagram name + a horizontal strip of its matched
//     snapshot cards ("Current" first). Groups keep grid-recency order.
//   - Interaction: live-as-you-type, 200ms debounce, (would be) a server round
//     trip against the tsvector index.
import { useState } from "react";
import { Search } from "lucide-react";
import { DiagramGrid, SnapshotCard, useDebounced } from "./shared";
import { stubSearch, totalSnapshots, type Tile } from "./stub-data";

export function VariantA({ tiles }: { tiles: Tile[] }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q, 200);
  const groups = stubSearch(tiles, query);
  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Diagrams</h1>
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search names & contents…"
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 py-1.5 pr-3 pl-8 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      {!searching && <DiagramGrid tiles={tiles} />}

      {searching && groups.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 py-16 text-center text-sm text-zinc-500">
          No diagrams contain <span className="text-zinc-300">“{query}”</span>.
        </div>
      )}

      {searching && groups.length > 0 && (
        <div className="space-y-8">
          <p className="text-xs text-zinc-500">
            {totalSnapshots(groups)} matches across {groups.length} diagram
            {groups.length === 1 ? "" : "s"}
          </p>
          {groups.map((g) => (
            <section key={g.diagramId}>
              <h2 className="mb-2 text-sm font-medium text-zinc-200">
                {g.name}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {g.matches.length} match{g.matches.length === 1 ? "" : "es"}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {g.matches.map((m) => (
                  <SnapshotCard key={m.key} diagramId={g.diagramId} match={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
