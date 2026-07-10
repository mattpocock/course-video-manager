import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Plus, Search } from "lucide-react";
import { sendToParent } from "@/lib/diagram-protocol";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { EditableDiagramName } from "@/features/diagrams/editable-diagram-name";
import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { filteredNewestSnapshot } from "@/lib/filtered-newest-snapshot";
import { data } from "react-router";
import type { Route } from "./+types/diagram-playground._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "Diagram Playground" }];
};

export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      const q = url.searchParams.get("q")?.trim() ?? "";
      const diagramOps = yield* DiagramOperationsService;

      if (q) {
        const results = yield* diagramOps.searchDiagrams(q);
        return data({
          mode: "search" as const,
          query: q,
          results: results.map(({ sortKey: _, ...rest }) => rest),
        });
      }

      const [allDiagrams, allSnapshots] = yield* Effect.all(
        [diagramOps.listDiagrams(), diagramOps.listAllSnapshotsWithClips()],
        { concurrency: "unbounded" }
      );

      const snapshotsByDiagram = new Map<
        string,
        {
          id: string;
          contentHash: string;
          preserved: boolean;
          createdAt: Date;
          clips: { archived: boolean }[];
        }[]
      >();
      for (const s of allSnapshots) {
        let arr = snapshotsByDiagram.get(s.diagramId);
        if (!arr) {
          arr = [];
          snapshotsByDiagram.set(s.diagramId, arr);
        }
        arr.push(s);
      }

      const tiles = allDiagrams.map((d) => {
        const snapshots = snapshotsByDiagram.get(d.id) ?? [];
        const newestId = filteredNewestSnapshot(snapshots);
        const newestSnapshot = newestId
          ? snapshots.find((s) => s.id === newestId)
          : null;
        return {
          id: d.id,
          name: d.name,
          updatedAt: d.updatedAt.toISOString(),
          thumbnailContentHash: newestSnapshot?.contentHash ?? null,
        };
      });

      return data({ mode: "grid" as const, tiles });
    }),
});

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function makeSnippet(searchText: string | null, query: string): string {
  if (!searchText) return "";
  const words = searchText.split(/\s+/);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const idx = words.findIndex((w) =>
    terms.some((t) => w.toLowerCase().includes(t))
  );
  const start = Math.max(0, idx > 0 ? idx - 3 : 0);
  const slice = words.slice(start, start + 10);
  return (
    (start > 0 ? "… " : "") +
    slice.join(" ") +
    (start + 10 < words.length ? " …" : "")
  );
}

export default function DiagramPlaygroundHome({
  loaderData,
}: Route.ComponentProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const currentQuery = searchParams.get("q") ?? "";
  const [inputValue, setInputValue] = useState(currentQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInputValue(currentQuery);
  }, [currentQuery]);

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim()) {
        setSearchParams({ q: value.trim() }, { replace: true });
      } else {
        setSearchParams({}, { replace: true });
      }
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    sendToParent({ type: "activeDiagramChanged", diagramId: null });
  }, []);

  useEffect(() => {
    function onFocus() {
      sendToParent({ type: "focus" });
    }
    function onBlur() {
      sendToParent({ type: "blur" });
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (document.hasFocus()) sendToParent({ type: "focus" });
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const handleSearchResultClick = useCallback(
    async (result: {
      diagramId: string;
      snapshotId: string | null;
      source: string;
    }) => {
      if (result.source === "snapshot" && result.snapshotId) {
        try {
          await fetch(`/api/diagrams/${result.diagramId}/restore-from-search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshotId: result.snapshotId }),
          });
        } catch {
          // Restore failed — navigate anyway to show the diagram
        }
      }
      navigate(`/diagram-playground/${result.diagramId}`);
    },
    [navigate]
  );

  const handleCreateDiagram = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/diagrams/create", { method: "POST" });
      if (!res.ok) return;
      const { id } = await res.json();
      navigate(`/diagram-playground/${id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-900 text-zinc-100">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-xl font-semibold">Diagrams</h1>
            <div className="relative w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={inputValue}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search names & contents…"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 py-1.5 pr-3 pl-8 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {loaderData.mode === "grid" && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              <button
                onClick={handleCreateDiagram}
                disabled={creating}
                className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 bg-zinc-800/50 text-zinc-400 transition-colors hover:border-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                <Plus className="mb-1 h-8 w-8" />
                <span className="text-sm font-medium">New Diagram</span>
              </button>

              {loaderData.tiles.map((tile) => (
                <div
                  key={tile.id}
                  className="group flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 transition-colors hover:border-zinc-500 hover:bg-zinc-700/60"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/diagram-playground/${tile.id}`)}
                    className="aspect-[4/3] w-full bg-zinc-900"
                  >
                    <DiagramThumbnail
                      diagramId={tile.id}
                      contentHash={tile.thumbnailContentHash ?? undefined}
                      className="h-full w-full object-contain"
                    />
                  </button>
                  <div className="flex flex-col gap-0.5 px-3 py-2 text-left">
                    <EditableDiagramName
                      diagramId={tile.id}
                      name={tile.name}
                      className="block truncate rounded text-sm font-medium hover:bg-zinc-700/60"
                      inputClassName="w-full rounded bg-zinc-900 px-1 text-sm font-medium text-zinc-100 outline-none ring-1 ring-zinc-500"
                    />
                    <span className="text-xs text-zinc-400">
                      {formatTimeAgo(new Date(tile.updatedAt))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loaderData.mode === "search" && loaderData.results.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-700 py-16 text-center text-sm text-zinc-500">
              No diagrams match{" "}
              <span className="text-zinc-300">
                &ldquo;{loaderData.query}&rdquo;
              </span>
              .
            </div>
          )}

          {loaderData.mode === "search" && loaderData.results.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {loaderData.results.map((result) => {
                const key = result.snapshotId ?? `${result.diagramId}:current`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSearchResultClick(result)}
                    className="group flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 text-left transition-colors hover:border-zinc-500 hover:bg-zinc-700/60"
                  >
                    <div className="relative aspect-[4/3] w-full bg-zinc-900">
                      <DiagramThumbnail
                        diagramId={result.diagramId}
                        contentHash={result.contentHash}
                        className="h-full w-full object-contain"
                      />
                      <span className="absolute right-1.5 bottom-1.5 max-w-[80%] truncate rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
                        {result.diagramName}
                      </span>
                    </div>
                    <p className="line-clamp-2 px-2 py-1.5 text-[11px] leading-snug text-zinc-400">
                      {makeSnippet(result.searchText, loaderData.query)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
