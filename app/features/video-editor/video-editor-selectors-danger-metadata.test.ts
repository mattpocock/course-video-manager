import { describe, expect, it } from "vitest";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  Chapter,
  FrontendId,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import {
  DANGEROUS_TEXT_SIMILARITY_THRESHOLD,
  getClipComputedProps,
  getAreAnyClipsDangerous,
  getClipDuration,
  getClipPercentComplete,
  getIsClipPortrait,
  getIsClipDangerous,
  getLastTranscribedClipId,
  getChapters,
  getHasSections,
  getIsOBSActive,
  getIsLiveStreamPortrait,
  getShouldShowLastFrameOverlay,
  getBackButtonUrl,
  getShowCenterLine,
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
// getClipComputedProps
// ---------------------------------------------------------------------------

describe("getClipComputedProps", () => {
  it("computes timecodes cumulatively", () => {
    const clips = [
      makeClipOnDatabase({
        frontendId: id("a"),
        sourceStartTime: 0,
        sourceEndTime: 65,
        text: "first",
      }),
      makeClipOnDatabase({
        frontendId: id("b"),
        sourceStartTime: 0,
        sourceEndTime: 5,
        text: "second",
      }),
    ];
    const props = getClipComputedProps(clips);
    expect(props.get(id("a"))?.timecode).toBe("0:00");
    expect(props.get(id("b"))?.timecode).toBe("1:05");
  });

  it("sets timecode to empty string for optimistic clips", () => {
    const clips: Clip[] = [makeOptimisticClip({ frontendId: id("a") })];
    const props = getClipComputedProps(clips);
    expect(props.get(id("a"))?.timecode).toBe("");
    expect(props.get(id("a"))?.nextLevenshtein).toBe(0);
  });

  it("computes levenshtein similarity between consecutive clips", () => {
    const clips = [
      makeClipOnDatabase({
        frontendId: id("a"),
        text: "hello world",
      }),
      makeClipOnDatabase({
        frontendId: id("b"),
        text: "hello world",
      }),
    ];
    const props = getClipComputedProps(clips);
    // Identical text -> 100% similarity
    expect(props.get(id("a"))?.nextLevenshtein).toBe(100);
    // Last clip has no next -> 0
    expect(props.get(id("b"))?.nextLevenshtein).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAreAnyClipsDangerous
// ---------------------------------------------------------------------------

describe("getAreAnyClipsDangerous", () => {
  it("returns true when consecutive clips have high similarity", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello world" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "hello world" }),
    ];
    expect(getAreAnyClipsDangerous(clips)).toBe(true);
  });

  it("returns false when clips are sufficiently different", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "the quick brown fox" }),
      makeClipOnDatabase({
        frontendId: id("b"),
        text: "completely different text here",
      }),
    ];
    expect(getAreAnyClipsDangerous(clips)).toBe(false);
  });

  it("returns false for empty clips", () => {
    expect(getAreAnyClipsDangerous([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-clip selectors
// ---------------------------------------------------------------------------

describe("getClipDuration", () => {
  it("returns duration for on-database clips", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      sourceStartTime: 10,
      sourceEndTime: 25,
    });
    expect(getClipDuration(clip)).toBe(15);
  });

  it("returns null for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    expect(getClipDuration(clip)).toBeNull();
  });
});

describe("getClipPercentComplete", () => {
  it("returns fraction of duration", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      sourceStartTime: 0,
      sourceEndTime: 10,
    });
    expect(getClipPercentComplete(clip, 5)).toBe(0.5);
  });

  it("returns 0 for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    expect(getClipPercentComplete(clip, 5)).toBe(0);
  });
});

describe("getIsClipPortrait", () => {
  it("returns true for TikTok profile", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      profile: "TikTok",
    });
    expect(getIsClipPortrait(clip)).toBe(true);
  });

  it("returns true for Portrait profile", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      profile: "Portrait",
    });
    expect(getIsClipPortrait(clip)).toBe(true);
  });

  it("returns false for other profiles", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      profile: "Default",
    });
    expect(getIsClipPortrait(clip)).toBe(false);
  });

  it("returns false for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    expect(getIsClipPortrait(clip)).toBe(false);
  });
});

describe("getIsClipDangerous", () => {
  it("returns true when levenshtein exceeds threshold", () => {
    const clip = makeClipOnDatabase({ frontendId: id("a") });
    const map = new Map([[id("a"), { timecode: "0:00", nextLevenshtein: 80 }]]);
    expect(getIsClipDangerous(clip, map)).toBe(true);
  });

  it("returns false below threshold", () => {
    const clip = makeClipOnDatabase({ frontendId: id("a") });
    const map = new Map([[id("a"), { timecode: "0:00", nextLevenshtein: 20 }]]);
    expect(getIsClipDangerous(clip, map)).toBe(false);
  });

  it("returns false at exact threshold", () => {
    const clip = makeClipOnDatabase({ frontendId: id("a") });
    const map = new Map([
      [
        id("a"),
        {
          timecode: "0:00",
          nextLevenshtein: DANGEROUS_TEXT_SIMILARITY_THRESHOLD,
        },
      ],
    ]);
    expect(getIsClipDangerous(clip, map)).toBe(false);
  });

  it("returns false for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    const map = new Map([[id("a"), { timecode: "", nextLevenshtein: 80 }]]);
    expect(getIsClipDangerous(clip, map)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Panel selectors
// ---------------------------------------------------------------------------

describe("getLastTranscribedClipId", () => {
  it("returns the last clip with text", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "world" }),
      makeClipOnDatabase({ frontendId: id("c"), text: "" }),
    ];
    expect(getLastTranscribedClipId(clips)).toBe(id("b"));
  });

  it("returns null when no clips have text", () => {
    const clips = [makeClipOnDatabase({ frontendId: id("a"), text: "" })];
    expect(getLastTranscribedClipId(clips)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(getLastTranscribedClipId([])).toBeNull();
  });
});

describe("getChapters", () => {
  it("filters items to chapters only", () => {
    const items: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeChapter(id("s2"), "Body"),
    ];
    const sections = getChapters(items);
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Body"]);
  });
});

describe("getHasSections", () => {
  it("returns true when sections exist", () => {
    const items: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
    ];
    expect(getHasSections(items)).toBe(true);
  });

  it("returns false when no sections", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
    ];
    expect(getHasSections(items)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(getHasSections([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OBS and live stream selectors
// ---------------------------------------------------------------------------

const obsNotRunning: OBSConnectionOuterState = { type: "obs-not-running" };
const obsConnected: OBSConnectionOuterState = {
  type: "obs-connected",
  profile: "Default",
  scene: "Camera",
  latestOutputPath: null,
};
const obsRecording: OBSConnectionOuterState = {
  type: "obs-recording",
  profile: "Default",
  scene: "Camera",
  latestOutputPath: "/output/path",
};

describe("getIsOBSActive", () => {
  it("returns true when OBS is connected", () => {
    expect(getIsOBSActive(obsConnected)).toBe(true);
  });

  it("returns true when OBS is recording", () => {
    expect(getIsOBSActive(obsRecording)).toBe(true);
  });

  it("returns false when OBS is not running", () => {
    expect(getIsOBSActive(obsNotRunning)).toBe(false);
  });
});

describe("getIsLiveStreamPortrait", () => {
  it("returns true when OBS is active with TikTok profile", () => {
    expect(
      getIsLiveStreamPortrait({ ...obsConnected, profile: "TikTok" })
    ).toBe(true);
  });

  it("returns true when OBS is recording with TikTok profile", () => {
    expect(
      getIsLiveStreamPortrait({ ...obsRecording, profile: "TikTok" })
    ).toBe(true);
  });

  it("returns false when OBS is active with non-TikTok profile", () => {
    expect(getIsLiveStreamPortrait(obsConnected)).toBe(false);
  });

  it("returns false when OBS is not running", () => {
    expect(getIsLiveStreamPortrait(obsNotRunning)).toBe(false);
  });
});

describe("getShouldShowLastFrameOverlay", () => {
  const clip = makeClipOnDatabase({
    frontendId: id("a"),
    scene: "Camera",
  });

  it("returns false when no clip provided", () => {
    expect(getShouldShowLastFrameOverlay(undefined, true, obsRecording)).toBe(
      false
    );
  });

  it("returns false when showLastFrame is false", () => {
    expect(getShouldShowLastFrameOverlay(clip, false, obsRecording)).toBe(
      false
    );
  });

  it("returns true regardless of scene match", () => {
    const differentScene: OBSConnectionOuterState = {
      ...obsRecording,
      scene: "Screen",
    };
    expect(getShouldShowLastFrameOverlay(clip, true, differentScene)).toBe(
      true
    );
  });

  it("returns true when clip and showLastFrame are truthy", () => {
    expect(getShouldShowLastFrameOverlay(clip, true, obsRecording)).toBe(true);
  });
});

describe("getBackButtonUrl", () => {
  it("returns lesson-specific URL when repoId and lessonId exist", () => {
    expect(getBackButtonUrl("repo-1", "lesson-1")).toBe(
      "/courses/repo-1#lesson-1"
    );
  });

  it("returns /videos when repoId is missing", () => {
    expect(getBackButtonUrl(undefined, "lesson-1")).toBe("/videos");
  });

  it("returns /videos when lessonId is missing", () => {
    expect(getBackButtonUrl("repo-1", undefined)).toBe("/videos");
  });

  it("returns /videos when both are missing", () => {
    expect(getBackButtonUrl(undefined, undefined)).toBe("/videos");
  });
});

describe("getShowCenterLine", () => {
  it("returns true when OBS is active and scene is Camera", () => {
    expect(getShowCenterLine({ ...obsConnected, scene: "Camera" })).toBe(true);
  });

  it("returns false when OBS is active but scene is not Camera", () => {
    expect(getShowCenterLine({ ...obsConnected, scene: "Screen" })).toBe(false);
  });

  it("returns false when OBS is not running", () => {
    expect(getShowCenterLine(obsNotRunning)).toBe(false);
  });

  it("returns true when OBS is recording with Camera scene", () => {
    expect(getShowCenterLine({ ...obsRecording, scene: "Camera" })).toBe(true);
  });
});
