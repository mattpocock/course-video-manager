import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { sendToParent } from "@/lib/diagram-protocol";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { EditableDiagramName } from "@/features/diagrams/editable-diagram-name";
import { Console, Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { filteredNewestSnapshot } from "@/lib/filtered-newest-snapshot";
import { data } from "react-router";
import type { Route } from "./+types/diagram-playground._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "Diagram Playground" }];
};

export const loader = async () => {
  return Effect.gen(function* () {
    const diagramOps = yield* DiagramOperationsService;
    const [diagrams, allSnapshots] = yield* Effect.all(
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

    const tiles = diagrams.map((d) => {
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

    return data({ tiles });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

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

export default function DiagramPlaygroundHome({
  loaderData,
}: Route.ComponentProps) {
  const { tiles } = loaderData;
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

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
          <h1 className="mb-6 text-xl font-semibold">Diagrams</h1>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {/* New Diagram tile */}
            <button
              onClick={handleCreateDiagram}
              disabled={creating}
              className="flex aspect-[4/3] flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-600 bg-zinc-800/50 text-zinc-400 transition-colors hover:border-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              <Plus className="mb-1 h-8 w-8" />
              <span className="text-sm font-medium">New Diagram</span>
            </button>

            {/* Diagram tiles */}
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
        </div>
      </div>
    </div>
  );
}
