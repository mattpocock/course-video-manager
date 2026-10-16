import { describe, expect, it } from "vitest";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendId,
  SessionId,
} from "./clip-state-reducer";
import {
  DANGEROUS_TEXT_SIMILARITY_THRESHOLD,
  getClipComputedProps,
  getAreAnyClipsDangerous,
  getClipPercentComplete,
  getIsClipPortrait,
  getIsClipDangerous,
  getLastTranscribedClipId,
  getBackButtonUrl,
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
  transcriptionStatus: "done",
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
});

// ---------------------------------------------------------------------------
// Per-clip selectors
// ---------------------------------------------------------------------------

describe("getClipPercentComplete", () => {
  it("returns fraction of duration", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      sourceStartTime: 0,
      sourceEndTime: 10,
    });
    expect(getClipPercentComplete(clip, 5)).toBe(0.5);
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

  const cvmRecorderClip = (format: "landscape" | "short") =>
    makeClipOnDatabase({
      frontendId: id("a"),
      profile: null,
      recordingSession: {
        id: "session-1",
        cameraFilePath: "/rec/camera.mkv",
        screenFilePath: "/rec/screen.mkv",
        micFilePath: "/rec/mic.mkv",
        micOffsetMs: 0,
        format,
        screenCaptured: format === "landscape",
        micEq: null,
        sceneEvents: [{ fileTime: 0, scene: "Camera" }],
      },
    });

  it("returns true for a CVM-recorder Clip of a Short Recording Session", () => {
    expect(getIsClipPortrait(cvmRecorderClip("short"))).toBe(true);
  });

  it("returns false for a CVM-recorder Clip of a Landscape Recording Session", () => {
    expect(getIsClipPortrait(cvmRecorderClip("landscape"))).toBe(false);
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
});

describe("getBackButtonUrl", () => {
  it("returns lesson-specific URL when repoId and lessonId exist", () => {
    expect(getBackButtonUrl("repo-1", "lesson-1", "landscape", null)).toBe(
      "/courses/repo-1#lesson-1"
    );
  });

  it("returns /videos when repoId is missing", () => {
    expect(getBackButtonUrl(null, "lesson-1", "landscape", null)).toBe(
      "/videos"
    );
  });

  it("returns /shorts when format is short and video is standalone", () => {
    expect(getBackButtonUrl(null, null, "short", null)).toBe("/shorts");
  });

  it("returns lesson URL when format is short but video has a lesson", () => {
    expect(getBackButtonUrl("repo-1", "lesson-1", "short", null)).toBe(
      "/courses/repo-1#lesson-1"
    );
  });

  it("returns pitch URL when pitchId exists", () => {
    expect(getBackButtonUrl(null, null, "landscape", "pitch-1")).toBe(
      "/pitches/pitch-1"
    );
  });

  it("returns pitch URL even when repoId and lessonId exist", () => {
    expect(getBackButtonUrl("repo-1", "lesson-1", "landscape", "pitch-1")).toBe(
      "/pitches/pitch-1"
    );
  });
});
