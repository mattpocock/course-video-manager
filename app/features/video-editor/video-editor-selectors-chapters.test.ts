import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  Chapter,
  FrontendId,
  TimelineItem,
} from "./clip-state-reducer";
import { getChapterForClip } from "./video-editor-selectors";

const makeClip = (
  overrides: Partial<ClipOnDatabase> & { frontendId: FrontendId }
): ClipOnDatabase => ({
  type: "on-database",
  databaseId: `db-${overrides.frontendId}` as any,
  videoFilename: "video.mp4",
  sourceStartTime: 0,
  sourceEndTime: 5,
  text: "hello",
  transcribedAt: new Date(),
  scene: null,
  profile: null,
  insertionOrder: null,
  beatType: "none",
  diagramSnapshotId: null,
  diagramName: null,
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

describe("getChapterForClip", () => {
  it("returns the chapter immediately before the clip", () => {
    const items: TimelineItem[] = [
      makeChapter(id("ch1"), "Intro"),
      makeClip({ frontendId: id("c1") }),
      makeClip({ frontendId: id("c2") }),
    ];
    expect(getChapterForClip(items, id("c1"))).toEqual(
      makeChapter(id("ch1"), "Intro")
    );
    expect(getChapterForClip(items, id("c2"))).toEqual(
      makeChapter(id("ch1"), "Intro")
    );
  });

  it("returns the nearest chapter when multiple chapters exist", () => {
    const items: TimelineItem[] = [
      makeChapter(id("ch1"), "Intro"),
      makeClip({ frontendId: id("c1") }),
      makeChapter(id("ch2"), "Body"),
      makeClip({ frontendId: id("c2") }),
      makeClip({ frontendId: id("c3") }),
    ];
    expect(getChapterForClip(items, id("c1"))).toEqual(
      makeChapter(id("ch1"), "Intro")
    );
    expect(getChapterForClip(items, id("c2"))).toEqual(
      makeChapter(id("ch2"), "Body")
    );
    expect(getChapterForClip(items, id("c3"))).toEqual(
      makeChapter(id("ch2"), "Body")
    );
  });

  it("returns undefined when clip has no preceding chapter", () => {
    const items: TimelineItem[] = [
      makeClip({ frontendId: id("c1") }),
      makeChapter(id("ch1"), "Intro"),
      makeClip({ frontendId: id("c2") }),
    ];
    expect(getChapterForClip(items, id("c1"))).toBeUndefined();
  });

  it("returns undefined when clip is not found in items", () => {
    const items: TimelineItem[] = [
      makeChapter(id("ch1"), "Intro"),
      makeClip({ frontendId: id("c1") }),
    ];
    expect(getChapterForClip(items, id("missing"))).toBeUndefined();
  });

  it("returns undefined for empty items", () => {
    expect(getChapterForClip([], id("c1"))).toBeUndefined();
  });
});
