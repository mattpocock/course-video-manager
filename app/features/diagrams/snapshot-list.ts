/**
 * The shape of `/api/diagrams/:id/snapshots/list`, and the one derivation both
 * readers of it need.
 *
 * Two surfaces consume that endpoint: the right-rail timeline, and the command
 * palette's "Restore to head". They must agree on what "the head is already
 * preserved" means, because that flag decides whether restoring shows a
 * confirmation dialog — a disagreement would silently lose work from one route
 * and not the other.
 */

export interface Snapshot {
  id: string;
  diagramId: string;
  scene: unknown;
  contentHash: string;
  preserved: boolean;
  createdAt: string;
}

export interface SnapshotListResponse {
  /** Oldest first. */
  snapshots: Snapshot[];
  headContentHash: string | null;
}

/**
 * Whether the current head state is already safely captured — i.e. some
 * preserved snapshot has the same content hash.
 *
 * When this is false, restoring discards work that exists nowhere else, which is
 * what the confirmation dialog is for.
 */
export function isHeadPreserved(
  snapshots: readonly Snapshot[],
  headContentHash: string | null
): boolean {
  if (headContentHash === null) return false;
  return snapshots.some(
    (s) => s.preserved && s.contentHash === headContentHash
  );
}
