import { useEffect, useState } from "react";

type SnapshotMeta = {
  scene: unknown;
  diagramId: string | null;
  contentHash: string | null;
};

const EMPTY: SnapshotMeta = { scene: null, diagramId: null, contentHash: null };

const metaCache = new Map<string, SnapshotMeta>();
const inflight = new Map<string, Promise<SnapshotMeta>>();

export const fetchMeta = (snapshotId: string): Promise<SnapshotMeta> => {
  const cached = metaCache.get(snapshotId);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = inflight.get(snapshotId);
  if (existing) return existing;

  const promise = fetch(`/api/diagram-snapshots/${snapshotId}`)
    .then((res) => (res.ok ? res.json() : null))
    .then(
      (
        data: {
          scene: unknown;
          diagramId: string;
          contentHash: string;
        } | null
      ) => {
        const meta: SnapshotMeta = data
          ? {
              scene: data.scene ?? null,
              diagramId: data.diagramId,
              contentHash: data.contentHash,
            }
          : EMPTY;
        metaCache.set(snapshotId, meta);
        return meta;
      }
    )
    .catch(() => EMPTY)
    .finally(() => {
      inflight.delete(snapshotId);
    });

  inflight.set(snapshotId, promise);
  return promise;
};

export const useDiagramSnapshotMeta = (snapshotId: string | null) => {
  const [meta, setMeta] = useState<SnapshotMeta>(() =>
    snapshotId ? (metaCache.get(snapshotId) ?? EMPTY) : EMPTY
  );

  useEffect(() => {
    if (!snapshotId) {
      setMeta(EMPTY);
      return;
    }
    let cancelled = false;
    fetchMeta(snapshotId).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  return meta;
};

export const useDiagramSnapshotScene = (snapshotId: string | null) => {
  return useDiagramSnapshotMeta(snapshotId).scene;
};
