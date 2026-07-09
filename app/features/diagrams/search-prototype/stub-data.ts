// PROTOTYPE — wayfinder #135. Throwaway. Delete when the search-box UI is chosen.
//
// The real content-search backend (tsvector over snapshot text) does not exist
// yet — this map is still planning. This module FABRICATES snapshot-grain search
// results so the UI variants have something concrete to render. It honours the
// result SHAPE locked by ticket #131:
//   - results are snapshot-grain, grouped under their diagram
//   - each diagram's live head_scene surfaces as a "Current" entry
//   - order = existing grid recency (no relevance rank in v1)
//   - AND across terms, whole-word-ish match
// It does NOT do real tsvector matching — it substring-matches fabricated text.

export type Tile = {
  id: string;
  name: string;
  updatedAt: string;
  thumbnailContentHash: string | null;
};

export type StubMatch = {
  key: string;
  kind: "current" | "snapshot";
  contentHash: string | null;
  /** e.g. "Current" | "Preserved · 3d ago" */
  label: string;
  /** fabricated line of text the query matched inside */
  snippet: string;
  createdAt: string;
};

export type StubGroup = {
  diagramId: string;
  name: string;
  updatedAt: string;
  matches: StubMatch[];
};

// A shared bag of words so fabricated snapshots contain plausible diagram text.
const VOCAB = [
  "effect",
  "layer",
  "runtime",
  "schema",
  "queue",
  "worker",
  "retry",
  "stream",
  "fiber",
  "context",
  "service",
  "loader",
  "action",
  "cache",
  "postgres",
  "tsvector",
  "index",
  "snapshot",
  "diagram",
  "pipeline",
  "prompt",
  "token",
  "model",
  "embedding",
  "chunk",
  "route",
  "middleware",
  "session",
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic fabricated text blob for a given document seed. */
function fabricateText(seed: string, name: string): string {
  const h = hash(seed);
  const words: string[] = name.toLowerCase().split(/\s+/).filter(Boolean);
  const count = 6 + (h % 6);
  for (let i = 0; i < count; i++) {
    words.push(VOCAB[(h >> (i % 24)) % VOCAB.length]!);
  }
  return words.join(" ");
}

function timeAgo(from: string, daysBack: number): string {
  const d = new Date(new Date(from).getTime() - daysBack * 86_400_000);
  if (daysBack < 1) return "just now";
  if (daysBack < 30) return `${daysBack}d ago`;
  return d.toLocaleDateString();
}

/** AND across terms, each term a whole-ish word match (loose tsquery stand-in). */
function matches(text: string, terms: string[]): boolean {
  return terms.every((t) => text.includes(t));
}

function snippet(text: string, terms: string[]): string {
  const words = text.split(" ");
  const idx = words.findIndex((w) => terms.some((t) => w.includes(t)));
  const start = Math.max(0, idx - 4);
  return (
    (start > 0 ? "… " : "") + words.slice(start, start + 12).join(" ") + " …"
  );
}

/**
 * Fabricate grouped, snapshot-grain results for a query.
 * `tiles` arrive already in grid-recency order; group order is preserved.
 */
export function stubSearch(tiles: Tile[], query: string): StubGroup[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const groups: StubGroup[] = [];
  for (const tile of tiles) {
    const seed = hash(tile.id);
    // Each diagram has a "Current" (head) doc + 0..3 historical snapshots.
    const snapCount = seed % 4;

    const docs: StubMatch[] = [];

    const headText = fabricateText(tile.id + ":head", tile.name);
    if (matches(headText, terms)) {
      docs.push({
        key: `${tile.id}:current`,
        kind: "current",
        contentHash: tile.thumbnailContentHash,
        label: "Current",
        snippet: snippet(headText, terms),
        createdAt: tile.updatedAt,
      });
    }

    for (let i = 0; i < snapCount; i++) {
      const snapSeed = `${tile.id}:snap:${i}`;
      const text = fabricateText(snapSeed, tile.name);
      if (!matches(text, terms)) continue;
      const daysBack = 2 + ((hash(snapSeed) % 40) + i * 3);
      docs.push({
        key: snapSeed,
        kind: "snapshot",
        contentHash: tile.thumbnailContentHash,
        label: `Preserved · ${timeAgo(tile.updatedAt, daysBack)}`,
        snippet: snippet(text, terms),
        createdAt: new Date(
          new Date(tile.updatedAt).getTime() - daysBack * 86_400_000
        ).toISOString(),
      });
    }

    if (docs.length > 0) {
      groups.push({
        diagramId: tile.id,
        name: tile.name,
        updatedAt: tile.updatedAt,
        matches: docs,
      });
    }
  }
  return groups;
}

export function totalSnapshots(groups: StubGroup[]): number {
  return groups.reduce((n, g) => n + g.matches.length, 0);
}
