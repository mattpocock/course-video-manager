import { isVisibleInTimeline } from "./timeline-visibility";

type SnapshotRow = {
  id: string;
  preserved: boolean;
  createdAt: Date;
  clips: { archived: boolean }[];
};

/**
 * The thumbnail hash every diagram tile shows: the newest TIMELINE-VISIBLE
 * snapshot's content hash, per diagram.
 *
 * Shared by Playground Home's grid and the palette's recent-diagram list, so
 * the same diagram never shows one picture in one place and another elsewhere.
 * Diagrams with no visible snapshot are absent — they have no render to point
 * at.
 */
export function newestSnapshotHashByDiagram(
  snapshots: (SnapshotRow & { diagramId: string; contentHash: string })[]
): Map<string, string> {
  const byDiagram = new Map<
    string,
    (SnapshotRow & { contentHash: string })[]
  >();
  for (const s of snapshots) {
    let arr = byDiagram.get(s.diagramId);
    if (!arr) {
      arr = [];
      byDiagram.set(s.diagramId, arr);
    }
    arr.push(s);
  }

  const hashes = new Map<string, string>();
  for (const [diagramId, rows] of byDiagram) {
    const newestId = filteredNewestSnapshot(rows);
    const newest = newestId ? rows.find((s) => s.id === newestId) : null;
    if (newest) hashes.set(diagramId, newest.contentHash);
  }
  return hashes;
}

export function filteredNewestSnapshot(
  snapshots: SnapshotRow[]
): string | null {
  let newest: { id: string; createdAt: Date } | null = null;

  for (const s of snapshots) {
    if (!isVisibleInTimeline(s, s.clips)) continue;
    if (!newest || s.createdAt > newest.createdAt) {
      newest = s;
    }
  }

  return newest?.id ?? null;
}
