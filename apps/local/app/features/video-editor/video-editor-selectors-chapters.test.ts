import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  Chapter,
  FrontendId,
  TimelineItem,
} from "./clip-state-reducer";
import {
  getChapterForClip,
  getChapterPercentComplete,
} from "./video-editor-selectors";

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
  pauseType: "none",
  zoomType: "none",
  diagramSnapshotId: null,
  diagramName: null,
  webLinks: [],
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

describe("getChapterPercentComplete", () => {
  /** Two ten-second Clips under `ch1`, one under `ch2`. */
  const items: TimelineItem[] = [
    makeChapter(id("ch1"), "Intro"),
    makeClip({ frontendId: id("c1"), sourceStartTime: 0, sourceEndTime: 10 }),
    makeClip({ frontendId: id("c2"), sourceStartTime: 0, sourceEndTime: 10 }),
    makeChapter(id("ch2"), "Body"),
    makeClip({ frontendId: id("c3"), sourceStartTime: 0, sourceEndTime: 10 }),
  ];

  it("counts every clip under the title, not just the one playing", () => {
    // Halfway through the first of two clips is a quarter of the chapter.
    expect(
      getChapterPercentComplete({
        items,
        chapterId: id("ch1"),
        currentClipId: id("c1"),
        currentTimeInClip: 5,
      })
    ).toBe(0.25);

    // The second clip starts with the first one's ten seconds behind it.
    expect(
      getChapterPercentComplete({
        items,
        chapterId: id("ch1"),
        currentClipId: id("c2"),
        currentTimeInClip: 5,
      })
    ).toBe(0.75);
  });

  it("stops at the next title, so a later chapter's clips are not counted", () => {
    expect(
      getChapterPercentComplete({
        items,
        chapterId: id("ch2"),
        currentClipId: id("c3"),
        currentTimeInClip: 5,
      })
    ).toBe(0.5);
  });

  it("is null for a chapter that is not the one playing", () => {
    expect(
      getChapterPercentComplete({
        items,
        chapterId: id("ch2"),
        currentClipId: id("c1"),
        currentTimeInClip: 5,
      })
    ).toBeNull();
  });

  it("is null while nothing plays", () => {
    expect(
      getChapterPercentComplete({
        items,
        chapterId: id("ch1"),
        currentClipId: undefined,
        currentTimeInClip: 0,
      })
    ).toBeNull();
  });

  it("is null for a chapter holding nothing with a measured duration", () => {
    expect(
      getChapterPercentComplete({
        items: [
          makeChapter(id("ch1"), "Intro"),
          makeClip({
            frontendId: id("c1"),
            sourceStartTime: 0,
            sourceEndTime: 0,
          }),
        ],
        chapterId: id("ch1"),
        currentClipId: id("c1"),
        currentTimeInClip: 0,
      })
    ).toBeNull();
  });

  it("never reads past full, however far into the last clip the time has run", () => {
    expect(
      getChapterPercentComplete({
        items,
        chapterId: id("ch1"),
        currentClipId: id("c2"),
        currentTimeInClip: 999,
      })
    ).toBe(1);
  });
});
