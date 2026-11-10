import { useCallback, useEffect, useState } from "react";
import { Archive, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { copySceneToClipboard } from "@/features/diagrams/copy-scene-to-clipboard";
import {
  fetchSnapshotList,
  type Snapshot,
} from "@/features/diagrams/snapshot-list";
import { usePlaygroundStatus } from "@/features/diagrams/playground-status";
import { railRowClass } from "@/features/diagrams/rail-row-class";

export type { Snapshot };

export function TimelinePanel({
  diagramId,
  onRestoreRequest,
  refreshKey,
  activeContentHash,
}: {
  diagramId: string;
  /**
   * `timeline` is the list the row was picked from; the page decides from it
   * whether the head it overwrites must be kept first.
   */
  onRestoreRequest: (snapshot: Snapshot, timeline: Snapshot[]) => void;
  /**
   * Refetch the timeline when this changes: the page's own writes bump it,
   * and so does a snapshot that changed on the server (`timelineHash`).
   */
  refreshKey: string;
  /** The snapshot on the canvas, by content (`activeSnapshotHash`). */
  activeContentHash: string | null;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const status = usePlaygroundStatus();

  const fetchSnapshots = useCallback(() => {
    let cancelled = false;

    const apply = (data: Awaited<ReturnType<typeof fetchSnapshotList>>) => {
      if (cancelled) return;
      if (data) {
        setSnapshots(data.snapshots);
      }
      setHasLoadedOnce(true);
    };
    // fetchSnapshotList answers null for a failed fetch; a rejection means
    // the same thing: keep the timeline that is showing.
    fetchSnapshotList(diagramId).then(apply, () => apply(null));

    return () => {
      cancelled = true;
    };
  }, [diagramId]);

  useEffect(() => {
    return fetchSnapshots();
  }, [fetchSnapshots, refreshKey]);

  const handleRestoreClick = (snapshot: Snapshot) => {
    onRestoreRequest(snapshot, snapshots);
  };

  const handleCopy = (snapshot: Snapshot) => {
    copySceneToClipboard(snapshot.scene).then(
      (result) => {
        switch (result) {
          case "ok":
            status.reportSuccess();
            return;
          case "empty":
            status.reportError("Snapshot has no shapes to copy");
            return;
          case "error":
            status.reportError("Failed to copy snapshot");
            return;
        }
      },
      () => {
        status.reportError("Failed to copy snapshot");
      }
    );
  };

  const handleArchive = (snapshot: Snapshot) => {
    setArchivingId(snapshot.id);
    fetch(`/api/diagram-snapshots/${snapshot.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    })
      .then((res) => {
        if (!res.ok) {
          status.reportError("Failed to archive snapshot");
          return;
        }
        status.reportSuccess();
        setSnapshots((prev) => prev.filter((s) => s.id !== snapshot.id));
      })
      .catch(() => {
        status.reportError("Failed to archive snapshot");
      })
      .finally(() => {
        setArchivingId(null);
      });
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
          aria-current={
            snapshot.contentHash === activeContentHash ? "true" : undefined
          }
          className={
            "group flex h-14 items-center gap-2 overflow-hidden rounded border pr-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 " +
            railRowClass(snapshot.contentHash === activeContentHash)
          }
        >
          <DiagramThumbnail
            // A snapshot redrawn in place keeps its id; its picture is new.
            key={snapshot.contentHash}
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
