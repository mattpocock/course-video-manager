import { useCallback, useEffect, useState } from "react";
import { Archive, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { copySceneToClipboard } from "@/features/diagrams/copy-scene-to-clipboard";
import {
  fetchSnapshotList,
  isHeadPreserved,
  type Snapshot,
} from "@/features/diagrams/snapshot-list";

export type { Snapshot };

export function TimelinePanel({
  diagramId,
  onRestoreRequest,
  refreshKey,
}: {
  diagramId: string;
  onRestoreRequest: (snapshot: Snapshot, headIsPreserved: boolean) => void;
  refreshKey: number;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [headContentHash, setHeadContentHash] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const fetchSnapshots = useCallback(() => {
    let cancelled = false;

    fetchSnapshotList(diagramId).then((data) => {
      if (cancelled) return;
      if (data) {
        setSnapshots(data.snapshots);
        setHeadContentHash(data.headContentHash);
      }
      setHasLoadedOnce(true);
    });

    return () => {
      cancelled = true;
    };
  }, [diagramId]);

  useEffect(() => {
    return fetchSnapshots();
  }, [fetchSnapshots, refreshKey]);

  const handleRestoreClick = (snapshot: Snapshot) => {
    onRestoreRequest(snapshot, isHeadPreserved(snapshots, headContentHash));
  };

  const handleCopy = async (snapshot: Snapshot) => {
    const result = await copySceneToClipboard(snapshot.scene);
    if (result === "ok") {
      toast.success("Snapshot copied — paste into the canvas");
    } else if (result === "empty") {
      toast.error("Snapshot has no shapes to copy");
    } else {
      toast.error("Failed to copy snapshot");
    }
  };

  const handleArchive = async (snapshot: Snapshot) => {
    setArchivingId(snapshot.id);
    try {
      const res = await fetch(`/api/diagram-snapshots/${snapshot.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) {
        toast.error("Failed to archive snapshot");
        return;
      }
      setSnapshots((prev) => prev.filter((s) => s.id !== snapshot.id));
    } catch {
      toast.error("Failed to archive snapshot");
    } finally {
      setArchivingId(null);
    }
  };

  if (!hasLoadedOnce) {
    return <div className="p-3" />;
  }

  if (snapshots.length === 0) {
    return <div className="p-3 text-xs text-zinc-400">No snapshots yet</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {snapshots.map((snapshot) => (
        <button
          key={snapshot.id}
          type="button"
          onClick={() => handleRestoreClick(snapshot)}
          title="Restore snapshot"
          className="group flex h-14 items-center gap-2 overflow-hidden rounded border border-zinc-700 bg-zinc-800 pr-2 text-left hover:bg-zinc-700/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
        >
          <DiagramThumbnail
            diagramId={snapshot.diagramId}
            contentHash={snapshot.contentHash}
            scene={snapshot.scene}
            className="h-full w-20 shrink-0 object-contain bg-zinc-900"
          />
          <div className="min-w-0 flex-1" />
          <Button
            asChild
            variant="ghost"
            size="icon"
            title="Copy contents"
            aria-label="Copy snapshot contents"
            className="h-7 w-7 text-zinc-300 hover:text-zinc-100"
          >
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                handleCopy(snapshot);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopy(snapshot);
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </span>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            title="Archive"
            aria-label="Archive snapshot"
            className="h-7 w-7 text-zinc-300 hover:text-zinc-100"
            disabled={archivingId === snapshot.id}
          >
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (archivingId !== snapshot.id) handleArchive(snapshot);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (archivingId !== snapshot.id) handleArchive(snapshot);
                }
              }}
            >
              <Archive className="h-3.5 w-3.5" />
            </span>
          </Button>
        </button>
      ))}
    </div>
  );
}
