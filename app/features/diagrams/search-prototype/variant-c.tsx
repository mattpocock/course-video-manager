// PROTOTYPE — wayfinder #135. Variant C: flat snapshot stream + scope toggle.
//
// Design answers this variant embodies:
//   - Placement: a centred, prominent search field with a segmented SCOPE
//     control beside it (Both / Name / Content) — the composition question made
//     explicit and user-controllable rather than baked in.
//   - Results: ONE flat grid of snapshot cards, no per-diagram group headers.
//     Grouping is implied by a diagram-name chip on each card. Ordered by
//     recency across the whole corpus (matches #131's "no relevance rank").
//   - No query -> the normal diagram grid.
//   - Query -> flat stream. Fastest to scan when matches are spread thin (one
//     snapshot each across many diagrams); weakest when one diagram dominates.
import { useState } from "react";
import { Search } from "lucide-react";
import { DiagramGrid, SnapshotCard, useDebounced } from "./shared";
import { stubSearch, totalSnapshots, type Tile } from "./stub-data";

type Scope = "both" | "name" | "content";

export function VariantC({ tiles }: { tiles: Tile[] }) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("both");
  const query = useDebounced(q, 200);
  const groups = stubSearch(tiles, query);
  const searching = query.trim().length > 0;

  // flatten to a single recency-ordered stream (groups already in grid order)
  const cards = groups.flatMap((g) =>
    g.matches.map((m) => ({ group: g, match: m }))
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-col items-center gap-3 pt-4">
        <h1 className="text-xl font-semibold">Diagrams</h1>
        <div className="flex w-full max-w-xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search diagrams…"
              className="w-full rounded-full border border-zinc-700 bg-zinc-800 py-2 pr-4 pl-10 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex overflow-hidden rounded-full border border-zinc-700 text-xs">
            {(["both", "name", "content"] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-2 capitalize ${
                  scope === s
                    ? "bg-zinc-200 text-zinc-900"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!searching && <DiagramGrid tiles={tiles} />}

      {searching && cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 py-16 text-center text-sm text-zinc-500">
          No {scope === "name" ? "diagram names" : "diagrams"} match{" "}
          <span className="text-zinc-300">“{query}”</span>.
        </div>
      )}

      {searching && cards.length > 0 && (
        <>
          <p className="mb-4 text-center text-xs text-zinc-500">
            {totalSnapshots(groups)} matches · scope: {scope}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {cards.map(({ group, match }) => (
              <SnapshotCard
                key={match.key}
                diagramId={group.diagramId}
                match={match}
                showDiagramChip
                diagramName={group.name}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
