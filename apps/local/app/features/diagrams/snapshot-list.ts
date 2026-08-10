/**
 * The shape of `/api/diagrams/:id/snapshots/list`, how to read it, and the one
 * derivation every reader needs.
 *
 * Three surfaces consume that endpoint: the right-rail timeline, the command
 * palette's "Restore to head", and a **Snapshot Step**. They must agree on what
 * "the head is already captured" means, because that flag decides whether
 * restoring shows a confirmation dialog — a disagreement would silently lose
 * work from one route and not the other.
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
 * Read the timeline, or `null` if it could not be read.
 *
 * A refused response and a dead network are the same thing to every caller —
 * there is no timeline to act on — so they collapse into one absent value
 * instead of two branches each caller has to remember to write. Callers own the
 * message, since "no timeline" reads differently in each surface.
 */
export async function fetchSnapshotList(
  diagramId: string
): Promise<SnapshotListResponse | null> {
  try {
    const res = await fetch(`/api/diagrams/${diagramId}/snapshots/list`);
    if (!res.ok) return null;
    return (await res.json()) as SnapshotListResponse;
  } catch {
    return null;
  }
}

/**
 * Whether the current head state is already safely captured — i.e. some snapshot
 * *on the timeline* has the same content hash.
 *
 * When this is false, restoring discards work that exists nowhere else, which is
 * what the confirmation dialog is for.
 *
 * Preserved and Clip-pinned both count. The endpoint has already dropped the
 * snapshots that are no longer visible, so anything still in this list is
 * content the author can get back to by clicking a row — warning that it "won't
 * be recoverable" would be pointing at a thumbnail sitting right there. That
 * matters most for a **Snapshot Step**: stepping onto a Clip-pinned snapshot
 * would otherwise make the next keypress raise a dialog about the snapshot it
 * just landed on, so walking a run of them meant confirming every hop.
 */
export function isHeadCaptured(
  snapshots: readonly Snapshot[],
  headContentHash: string | null
): boolean {
  if (headContentHash === null) return false;
  return snapshots.some((s) => s.contentHash === headContentHash);
}
