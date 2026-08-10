import { describe, it, expect } from "vitest";
import {
  filteredNewestSnapshot,
  newestSnapshotHashByDiagram,
} from "./filtered-newest-snapshot";

interface TestSnapshot {
  id: string;
  preserved: boolean;
  createdAt: Date;
  clips: { archived: boolean }[];
}

function snap(
  id: string,
  opts: {
    preserved?: boolean;
    createdAt?: Date;
    clips?: { archived: boolean }[];
  } = {}
): TestSnapshot {
  return {
    id,
    preserved: opts.preserved ?? false,
    createdAt: opts.createdAt ?? new Date("2024-01-01"),
    clips: opts.clips ?? [],
  };
}

describe("filteredNewestSnapshot", () => {
  it("returns null when diagram has zero snapshots", () => {
    expect(filteredNewestSnapshot([])).toBeNull();
  });

  it("returns a preserved snapshot", () => {
    const s = snap("s1", { preserved: true });
    expect(filteredNewestSnapshot([s])).toBe("s1");
  });

  it("returns a non-preserved snapshot pinned by a non-archived clip", () => {
    const s = snap("s1", { clips: [{ archived: false }] });
    expect(filteredNewestSnapshot([s])).toBe("s1");
  });

  it("returns null for a non-preserved snapshot pinned only by an archived clip", () => {
    const s = snap("s1", { clips: [{ archived: true }] });
    expect(filteredNewestSnapshot([s])).toBeNull();
  });

  it("returns the newer of two qualifying snapshots", () => {
    const older = snap("s1", {
      preserved: true,
      createdAt: new Date("2024-01-01"),
    });
    const newer = snap("s2", {
      preserved: true,
      createdAt: new Date("2024-02-01"),
    });
    expect(filteredNewestSnapshot([older, newer])).toBe("s2");
  });

  it("returns the older qualifying snapshot when the newer one does not qualify", () => {
    const older = snap("s1", {
      preserved: true,
      createdAt: new Date("2024-01-01"),
    });
    const newer = snap("s2", {
      preserved: false,
      createdAt: new Date("2024-02-01"),
      clips: [{ archived: true }],
    });
    expect(filteredNewestSnapshot([older, newer])).toBe("s1");
  });

  it("returns a snapshot that is both preserved and pinned by an archived clip", () => {
    const s = snap("s1", {
      preserved: true,
      clips: [{ archived: true }],
    });
    expect(filteredNewestSnapshot([s])).toBe("s1");
  });

  it("returns a non-preserved snapshot when it has both archived and non-archived clips", () => {
    const s = snap("s1", {
      clips: [{ archived: true }, { archived: false }],
    });
    expect(filteredNewestSnapshot([s])).toBe("s1");
  });

  it("returns null when all snapshots fail the filter", () => {
    const s1 = snap("s1", {
      preserved: false,
      createdAt: new Date("2024-01-01"),
      clips: [{ archived: true }],
    });
    const s2 = snap("s2", {
      preserved: false,
      createdAt: new Date("2024-02-01"),
      clips: [],
    });
    expect(filteredNewestSnapshot([s1, s2])).toBeNull();
  });
});

describe("newestSnapshotHashByDiagram", () => {
  function row(
    id: string,
    diagramId: string,
    contentHash: string,
    opts: { preserved?: boolean; createdAt?: Date } = {}
  ) {
    return { ...snap(id, opts), diagramId, contentHash };
  }

  it("picks the newest visible snapshot's hash, per diagram", () => {
    const hashes = newestSnapshotHashByDiagram([
      row("a1", "d1", "old", {
        preserved: true,
        createdAt: new Date("2024-01-01"),
      }),
      row("a2", "d1", "new", {
        preserved: true,
        createdAt: new Date("2024-03-01"),
      }),
      row("b1", "d2", "other", { preserved: true }),
    ]);
    expect(hashes.get("d1")).toBe("new");
    expect(hashes.get("d2")).toBe("other");
  });

  it("applies the SAME visibility filter the timeline does", () => {
    // An unpreserved snapshot with no live clip pinning it is invisible in the
    // timeline, so it must not become a diagram's cover picture either.
    const hashes = newestSnapshotHashByDiagram([
      row("a1", "d1", "visible", {
        preserved: true,
        createdAt: new Date("2024-01-01"),
      }),
      row("a2", "d1", "invisible", {
        preserved: false,
        createdAt: new Date("2024-03-01"),
      }),
    ]);
    expect(hashes.get("d1")).toBe("visible");
  });

  it("omits a diagram with nothing visible, rather than inventing a hash", () => {
    const hashes = newestSnapshotHashByDiagram([row("a1", "d1", "hidden")]);
    expect(hashes.has("d1")).toBe(false);
  });
});
