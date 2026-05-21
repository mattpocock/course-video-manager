import { describe, expect, it } from "vitest";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  Chapter,
  FrontendId,
  FrontendInsertionPoint,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import {
  getClips,
  getCurrentClipIndex,
  getNextClip,
  getSelectedClipId,
  getClipsToAggressivelyPreload,
  getTotalDuration,
  getShowVideoPlayer,
  getShowLiveStream,
  getShowLastFrame,
  getDatabaseClipBeforeInsertionPoint,
  getCurrentClip,
  getAllClipsHaveSilenceDetected,
  getAllClipsHaveText,
} from "./video-editor-selectors";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeClipOnDatabase = (
  overrides: Partial<ClipOnDatabase> & { frontendId: FrontendId }
): ClipOnDatabase => ({
  type: "on-database",
  databaseId: `db-${overrides.frontendId}` as any,
  videoFilename: "video.mp4",
  sourceStartTime: 0,
  sourceEndTime: 5,
  text: "hello world",
  transcribedAt: new Date(),
  scene: null,
  profile: null,
  insertionOrder: null,
  beatType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  ...overrides,
});

const makeOptimisticClip = (
  overrides: Partial<ClipOptimisticallyAdded> & { frontendId: FrontendId }
): ClipOptimisticallyAdded => ({
  type: "optimistically-added",
  scene: "Camera",
  profile: "Default",
  insertionOrder: 0,
  beatType: "none",
  soundDetectionId: "sd-1",
  sessionId: "test-session" as SessionId,
  ...overrides,
});

const makeChapter = (frontendId: FrontendId, name: string): Chapter => ({
  type: "chapter-on-database",
  frontendId,
  databaseId: `db-${frontendId}` as any,
  name,
  insertionOrder: null,
});

const id = (s: string) => s as FrontendId;

// ---------------------------------------------------------------------------
// Top-level selectors
// ---------------------------------------------------------------------------

describe("getClips", () => {
  it("filters out chapters", () => {
    const items: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeChapter(id("s2"), "Body"),
      makeClipOnDatabase({ frontendId: id("c2") }),
    ];
    const clips = getClips(items);
    expect(clips).toHaveLength(2);
    expect(clips.map((c) => c.frontendId)).toEqual([id("c1"), id("c2")]);
  });

  it("returns empty array for no clips", () => {
    expect(getClips([])).toEqual([]);
  });
});

describe("getCurrentClipIndex", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
  ];

  it("returns index of matching clip", () => {
    expect(getCurrentClipIndex(clips, id("b"))).toBe(1);
  });

  it("returns -1 when not found", () => {
    expect(getCurrentClipIndex(clips, id("z"))).toBe(-1);
  });

  it("returns -1 for undefined", () => {
    expect(getCurrentClipIndex(clips, undefined)).toBe(-1);
  });
});

describe("getNextClip", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
    makeClipOnDatabase({ frontendId: id("c") }),
  ];

  it("returns the clip after the current one", () => {
    expect(getNextClip(clips, id("a"))?.frontendId).toBe(id("b"));
  });

  it("returns undefined for the last clip", () => {
    expect(getNextClip(clips, id("c"))).toBeUndefined();
  });

  it("returns first clip when current clip not found (index -1 + 1 = 0)", () => {
    expect(getNextClip(clips, id("z"))?.frontendId).toBe(id("a"));
  });
});

describe("getSelectedClipId", () => {
  it("returns first selected clip", () => {
    const set = new Set([id("a"), id("b")]);
    expect(getSelectedClipId(set)).toBe(id("a"));
  });

  it("returns undefined for empty set", () => {
    expect(getSelectedClipId(new Set())).toBeUndefined();
  });
});

describe("getClipsToAggressivelyPreload", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
    makeClipOnDatabase({ frontendId: id("c") }),
  ];

  it("includes current, next, and selected clip ids", () => {
    const result = getClipsToAggressivelyPreload(
      id("a"),
      clips,
      new Set([id("c")])
    );
    expect(result).toEqual([id("a"), id("b"), id("c")]);
  });

  it("deduplicates nothing (duplicates kept as in current behavior)", () => {
    // When selected clip IS the next clip, both appear
    const result = getClipsToAggressivelyPreload(
      id("a"),
      clips,
      new Set([id("b")])
    );
    expect(result).toEqual([id("a"), id("b"), id("b")]);
  });

  it("handles undefined currentClipId", () => {
    const result = getClipsToAggressivelyPreload(undefined, clips, new Set());
    // currentClipId undefined -> filtered out, but getNextClip returns clips[0] (index -1+1=0)
    expect(result).toEqual([id("a")]);
  });
});

describe("getTotalDuration", () => {
  it("sums on-database clip durations", () => {
    const clips = [
      makeClipOnDatabase({
        frontendId: id("a"),
        sourceStartTime: 0,
        sourceEndTime: 10,
      }),
      makeClipOnDatabase({
        frontendId: id("b"),
        sourceStartTime: 5,
        sourceEndTime: 15,
      }),
    ];
    expect(getTotalDuration(clips)).toBe(20);
  });

  it("ignores optimistically-added clips", () => {
    const clips: Clip[] = [
      makeClipOnDatabase({
        frontendId: id("a"),
        sourceStartTime: 0,
        sourceEndTime: 10,
      }),
      makeOptimisticClip({ frontendId: id("b") }),
    ];
    expect(getTotalDuration(clips)).toBe(10);
  });

  it("returns 0 for empty array", () => {
    expect(getTotalDuration([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// viewMode -> boolean selectors
// ---------------------------------------------------------------------------

describe("getShowVideoPlayer", () => {
  it("returns true when playing", () => {
    expect(getShowVideoPlayer("playing", true)).toBe(true);
    expect(getShowVideoPlayer("playing", false)).toBe(true);
  });

  it("returns false when paused with live stream", () => {
    expect(getShowVideoPlayer("paused", true)).toBe(false);
  });

  it("returns true when paused without live stream", () => {
    expect(getShowVideoPlayer("paused", false)).toBe(true);
  });
});

describe("getShowLiveStream", () => {
  it("returns true when stream exists and paused", () => {
    expect(getShowLiveStream(true, "paused")).toBe(true);
  });

  it("returns false when playing even with stream", () => {
    expect(getShowLiveStream(true, "playing")).toBe(false);
  });

  it("returns false when no stream", () => {
    expect(getShowLiveStream(false, "paused")).toBe(false);
  });
});

describe("getShowLastFrame", () => {
  it("returns true when flag is set", () => {
    expect(getShowLastFrame(true)).toBe(true);
  });

  it("returns false when flag is not set", () => {
    expect(getShowLastFrame(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDatabaseClipBeforeInsertionPoint
// ---------------------------------------------------------------------------

describe("getDatabaseClipBeforeInsertionPoint", () => {
  const items: TimelineItem[] = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeOptimisticClip({ frontendId: id("b") }),
    makeClipOnDatabase({ frontendId: id("c") }),
  ];

  it("returns undefined for start insertion point", () => {
    expect(
      getDatabaseClipBeforeInsertionPoint(items, { type: "start" })
    ).toBeUndefined();
  });

  it("returns last database clip for end insertion point", () => {
    const result = getDatabaseClipBeforeInsertionPoint(items, { type: "end" });
    expect(result?.frontendId).toBe(id("c"));
  });

  it("returns the clip for after-clip insertion point", () => {
    const insertionPoint: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: id("a"),
    };
    const result = getDatabaseClipBeforeInsertionPoint(items, insertionPoint);
    expect(result?.frontendId).toBe(id("a"));
  });

  it("returns undefined for after-clip pointing at optimistic clip", () => {
    const insertionPoint: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: id("b"),
    };
    expect(
      getDatabaseClipBeforeInsertionPoint(items, insertionPoint)
    ).toBeUndefined();
  });

  it("returns the last database clip before a chapter", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeClipOnDatabase({ frontendId: id("b") }),
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c") }),
    ];
    const result = getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
      type: "after-chapter",
      frontendChapterId: id("s1"),
    });
    expect(result?.frontendId).toBe(id("b"));
  });

  it("returns undefined when chapter is at the start", () => {
    const itemsWithSection: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("a") }),
    ];
    expect(
      getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
        type: "after-chapter",
        frontendChapterId: id("s1"),
      })
    ).toBeUndefined();
  });

  it("returns the database clip when section follows it directly", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeChapter(id("s1"), "Body"),
    ];
    const result = getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
      type: "after-chapter",
      frontendChapterId: id("s1"),
    });
    expect(result?.frontendId).toBe(id("a"));
  });

  it("skips optimistic clips when looking before a section", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeOptimisticClip({ frontendId: id("b") }),
      makeChapter(id("s1"), "Body"),
      makeClipOnDatabase({ frontendId: id("c") }),
    ];
    const result = getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
      type: "after-chapter",
      frontendChapterId: id("s1"),
    });
    expect(result?.frontendId).toBe(id("a"));
  });
});

// ---------------------------------------------------------------------------
// getCurrentClip
// ---------------------------------------------------------------------------

describe("getCurrentClip", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
  ];

  it("finds the current clip", () => {
    expect(getCurrentClip(clips, id("b"))?.frontendId).toBe(id("b"));
  });

  it("returns undefined when not found", () => {
    expect(getCurrentClip(clips, id("z"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// allClips checks
// ---------------------------------------------------------------------------

describe("getAllClipsHaveSilenceDetected", () => {
  it("returns true when all clips are on-database", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeClipOnDatabase({ frontendId: id("b") }),
    ];
    expect(getAllClipsHaveSilenceDetected(clips)).toBe(true);
  });

  it("returns false when any clip is optimistic", () => {
    const clips: Clip[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeOptimisticClip({ frontendId: id("b") }),
    ];
    expect(getAllClipsHaveSilenceDetected(clips)).toBe(false);
  });

  it("returns true for empty array", () => {
    expect(getAllClipsHaveSilenceDetected([])).toBe(true);
  });
});

describe("getAllClipsHaveText", () => {
  it("returns true when all database clips have text", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "world" }),
    ];
    expect(getAllClipsHaveText(clips)).toBe(true);
  });

  it("returns false when a clip has empty text", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "" }),
    ];
    expect(getAllClipsHaveText(clips)).toBe(false);
  });

  it("returns false for optimistic clips", () => {
    const clips: Clip[] = [makeOptimisticClip({ frontendId: id("a") })];
    expect(getAllClipsHaveText(clips)).toBe(false);
  });
});
