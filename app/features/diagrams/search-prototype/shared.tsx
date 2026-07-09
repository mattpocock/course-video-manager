// PROTOTYPE — wayfinder #135. Shared atoms (result card, resting grid, helpers).
// These are content atoms / the already-shipped resting state — NOT the layout
// under evaluation. Each variant is free to arrange them differently.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { EditableDiagramName } from "@/features/diagrams/editable-diagram-name";
import type { StubMatch, Tile } from "./stub-data";

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** One matched snapshot rendered as its own image (per #131). */
export function SnapshotCard({
  diagramId,
  match,
  showDiagramChip,
  diagramName,
}: {
  diagramId: string;
  match: StubMatch;
  showDiagramChip?: boolean;
  diagramName?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        // real feature would open the diagram AT this snapshot (#136 keeps head safe)
        navigate(
          match.kind === "current"
            ? `/diagram-playground/${diagramId}`
            : `/diagram-playground/${diagramId}?snapshot=${match.key}`
        )
      }
      className="group flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 text-left transition-colors hover:border-zinc-500 hover:bg-zinc-700/60"
    >
      <div className="relative aspect-[4/3] w-full bg-zinc-900">
        <DiagramThumbnail
          diagramId={diagramId}
          contentHash={match.contentHash ?? undefined}
          className="h-full w-full object-contain"
        />
        <span
          className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            match.kind === "current"
              ? "bg-emerald-500/90 text-emerald-950"
              : "bg-zinc-900/80 text-zinc-300"
          }`}
        >
          {match.label}
        </span>
        {showDiagramChip && (
          <span className="absolute right-1.5 bottom-1.5 max-w-[80%] truncate rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
            {diagramName}
          </span>
        )}
      </div>
      <p className="line-clamp-2 px-2 py-1.5 text-[11px] leading-snug text-zinc-400">
        {match.snippet}
      </p>
    </button>
  );
}

export function NewDiagramButton() {
  const navigate = useNavigate();
  const create = async () => {
    const res = await fetch("/api/diagrams/create", { method: "POST" });
    if (!res.ok) return;
    const { id } = await res.json();
    navigate(`/diagram-playground/${id}`);
  };
  return (
    <button
      onClick={create}
      className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 bg-zinc-800/50 text-zinc-400 transition-colors hover:border-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    >
      <Plus className="mb-1 h-8 w-8" />
      <span className="text-sm font-medium">New Diagram</span>
    </button>
  );
}

/** The already-shipped resting grid: one tile per diagram (newest thumbnail). */
export function DiagramGrid({ tiles }: { tiles: Tile[] }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      <NewDiagramButton />
      {tiles.map((tile) => (
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
  );
}

/** Debounced local query state — live-as-you-type, cheap client stub. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
