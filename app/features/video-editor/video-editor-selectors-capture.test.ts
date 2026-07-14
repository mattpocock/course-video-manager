import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendId,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import { isCaptureInProgress } from "./video-editor-selectors";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const id = (s: string) => s as FrontendId;
const sid = (s: string) => s as SessionId;

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
  sessionId: sid("s1"),
  ...overrides,
});

const makeSession = (
  overrides: Partial<RecordingSession> & { id: SessionId }
): RecordingSession => ({
  displayNumber: 1,
  status: "recording",
  outputPath: "/tmp/test.mkv",
  startedAt: 0,
  silenceLength: "short",
  ...overrides,
});

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
  latestOutputPath: "/tmp/out.mkv",
};

// ---------------------------------------------------------------------------
// isCaptureInProgress
// ---------------------------------------------------------------------------

describe("isCaptureInProgress", () => {
  it("is true when OBS is actively recording (even with idle sessions/clips)", () => {
    expect(isCaptureInProgress(obsRecording, [], [])).toBe(true);
  });

  it("is true when a session is still recording", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "recording" })];
    expect(isCaptureInProgress(obsConnected, [], sessions)).toBe(true);
  });

  it("is true when a session is polling/settling with no OBS recording", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "polling" })];
    expect(isCaptureInProgress(obsConnected, [], sessions)).toBe(true);
  });

  it("is true when a pending optimistic clip remains with idle sessions", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "done" })];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    expect(isCaptureInProgress(obsConnected, items, sessions)).toBe(true);
  });

  it("is false when fully idle and every clip is resolved (the editable case)", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "done" })];
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2") }),
    ];
    expect(isCaptureInProgress(obsConnected, items, sessions)).toBe(false);
  });

  it("is false with no sessions, no clips, OBS not running", () => {
    expect(isCaptureInProgress(obsNotRunning, [], [])).toBe(false);
  });

  it("ignores archived optimistic clips (they are resolved)", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "done" })];
    const items: TimelineItem[] = [
      makeOptimisticClip({
        frontendId: id("c1"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
    ];
    expect(isCaptureInProgress(obsConnected, items, sessions)).toBe(false);
  });

  it("ignores orphaned optimistic clips (no DB clip will ever arrive)", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "done" })];
    const items: TimelineItem[] = [
      makeOptimisticClip({
        frontendId: id("c1"),
        sessionId: sid("s1"),
        isOrphaned: true,
      }),
    ];
    expect(isCaptureInProgress(obsConnected, items, sessions)).toBe(false);
  });

  it("is true when recording with pending clips and an active session combined", () => {
    const sessions = [makeSession({ id: sid("s1"), status: "recording" })];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    expect(isCaptureInProgress(obsRecording, items, sessions)).toBe(true);
  });

  it("stays true through settling: OBS idle but a clip is still pending after stop", () => {
    // Recording stopped (OBS connected, session moved to polling) and a clip
    // hasn't resolved yet — the panel must remain frozen.
    const sessions = [makeSession({ id: sid("s1"), status: "polling" })];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    expect(isCaptureInProgress(obsConnected, items, sessions)).toBe(true);
  });
});
