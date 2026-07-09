// PROTOTYPE — wayfinder #135. Variant B: two-pane master / detail search console.
//
// Design answers this variant embodies:
//   - Placement: a prominent full-width search bar spans the top; below it the
//     page splits into a LEFT rail (matching diagrams) and a RIGHT pane (the
//     snapshot cards for the selected diagram, or all).
//   - Composition: single content-search box; the name filter is dropped in
//     favour of the diagram list acting as the name-level view.
//   - No query -> the resting state is the normal grid (search console only
//     appears once you search — no point splitting an unfiltered page).
//   - Query -> master list on the left (diagram name + match count), detail grid
//     on the right. "All results" pseudo-row shows everything flat.
//   - Good when a diagram has MANY matching snapshots: the left rail keeps the
//     diagram list scannable while the right pane goes deep.
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { DiagramGrid, SnapshotCard, useDebounced } from "./shared";
import { stubSearch, totalSnapshots, type Tile } from "./stub-data";

export function VariantB({ tiles }: { tiles: Tile[] }) {
  const [q, setQ] = useState("");
  const query = useDebounced(q, 200);
  const groups = stubSearch(tiles, query);
  const searching = query.trim().length > 0;

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [query]); // reset to "All" on new query

  const active = selected
    ? groups.filter((g) => g.diagramId === selected)
    : groups;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search inside every diagram…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-3 pr-4 pl-11 text-base text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>

      {!searching && (
        <>
          <h1 className="mb-4 text-lg font-semibold">Diagrams</h1>
          <DiagramGrid tiles={tiles} />
        </>
      )}

      {searching && groups.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-700 py-20 text-center text-sm text-zinc-500">
          Nothing matches <span className="text-zinc-300">“{query}”</span>.
        </div>
      )}

      {searching && groups.length > 0 && (
        <div className="flex gap-6">
          <aside className="w-60 shrink-0">
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => setSelected(null)}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                    selected === null
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  <span>All results</span>
                  <span className="text-xs text-zinc-500">
                    {totalSnapshots(groups)}
                  </span>
                </button>
              </li>
              {groups.map((g) => (
                <li key={g.diagramId}>
                  <button
                    onClick={() => setSelected(g.diagramId)}
                    className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                      selected === g.diagramId
                        ? "bg-zinc-700 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-zinc-500">
                      {g.matches.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {active.flatMap((g) =>
                g.matches.map((m) => (
                  <SnapshotCard
                    key={m.key}
                    diagramId={g.diagramId}
                    match={m}
                    showDiagramChip={selected === null}
                    diagramName={g.name}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
