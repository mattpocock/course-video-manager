import { describe, expect, it } from "vitest";
import type {
  Chapter,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendId,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import { getCopyableClipCount } from "./video-editor-selectors";

const id = (s: string) => s as FrontendId;

const makeClipOnDatabase = (
  overrides: Partial<ClipOnDatabase> & { frontendId: FrontendId }
): ClipOnDatabase => ({
  type: "on-database",
  databaseId: `db-${overrides.frontendId}` as never,
  videoFilename: "video.mp4",
  sourceStartTime: 0,
  sourceEndTime: 5,
  text: "hello world",
  transcribedAt: new Date(),
  scene: null,
  profile: null,
  insertionOrder: null,
  pauseType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  webLinks: [],
  ...overrides,
});

const makeOptimisticClip = (
  overrides: Partial<ClipOptimisticallyAdded> & { frontendId: FrontendId }
): ClipOptimisticallyAdded => ({
  type: "optimistically-added",
  scene: "Camera",
  profile: "Default",
  insertionOrder: 0,
  pauseType: "none",
  soundDetectionId: "sd-1",
  sessionId: "test-session" as SessionId,
  ...overrides,
});

const makeChapter = (frontendId: FrontendId, name: string): Chapter => ({
  type: "chapter-on-database",
  frontendId,
  databaseId: `db-${frontendId}` as never,
  name,
  insertionOrder: null,
});

describe("getCopyableClipCount", () => {
  it("counts the clips on the database", () => {
    const items: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2") }),
    ];

    expect(getCopyableClipCount(items)).toBe(2);
  });

  it("ignores clips still being recorded", () => {
    // Optimistic clips have no database row yet, so a copy would not pick
    // them up.
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2") }),
    ];

    expect(getCopyableClipCount(items)).toBe(1);
  });

  it("ignores clips on their way to the archive", () => {
    // copyVideo only duplicates non-archived clips.
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2"), shouldArchive: true }),
    ];

    expect(getCopyableClipCount(items)).toBe(1);
  });

  it("is zero for a video with no clips", () => {
    expect(getCopyableClipCount([])).toBe(0);
  });
});
