import { describe, expect, it } from "vitest";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  Chapter,
  FrontendId,
  SessionId,
  TimelineItem,
  RecordingSession,
} from "./clip-state-reducer";
import { getTimelineItems, getSessionPanels } from "./video-editor-selectors";

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
const sid = (s: string) => s as SessionId;

const makeSession = (
  overrides: Partial<RecordingSession> & { id: SessionId }
): RecordingSession => ({
  displayNumber: 1,
  status: "recording",
  outputPath: "/tmp/test.mkv",
  startedAt: Date.now(),
  pauseLength: "short",
  ...overrides,
});

// ---------------------------------------------------------------------------
// getTimelineItems
// ---------------------------------------------------------------------------

describe("getTimelineItems", () => {
  it("excludes optimistically-added clips", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2") }),
      makeClipOnDatabase({ frontendId: id("c3") }),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.frontendId)).toEqual([id("c1"), id("c3")]);
  });

  it("includes on-database clips", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2") }),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
  });

  it("includes chapters (on-database)", () => {
    const items: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeChapter(id("s2"), "Body"),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(3);
  });

  it("excludes chapters with shouldArchive", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      {
        type: "chapter-optimistically-added",
        frontendId: id("s1"),
        name: "Archived Section",
        insertionOrder: 1,
        shouldArchive: true,
      },
      makeChapter(id("s2"), "Visible Section"),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.frontendId)).toEqual([id("c1"), id("s2")]);
  });

  it("excludes on-database clips with shouldArchive", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2"), shouldArchive: true }),
      makeClipOnDatabase({ frontendId: id("c3") }),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.frontendId)).toEqual([id("c1"), id("c3")]);
  });

  it("returns empty array for empty input", () => {
    expect(getTimelineItems([])).toEqual([]);
  });

  it("returns empty array when all items are optimistic clips", () => {
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2") }),
    ];
    expect(getTimelineItems(items)).toEqual([]);
  });

  it("preserves order of remaining items", () => {
    const items: TimelineItem[] = [
      makeChapter(id("s1"), "Intro"),
      makeOptimisticClip({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2") }),
      makeOptimisticClip({ frontendId: id("c3") }),
      makeChapter(id("s2"), "Body"),
      makeClipOnDatabase({ frontendId: id("c4") }),
    ];
    const result = getTimelineItems(items);
    expect(result.map((i) => i.frontendId)).toEqual([
      id("s1"),
      id("c2"),
      id("s2"),
      id("c4"),
    ]);
  });
});

// ---------------------------------------------------------------------------
// getSessionPanels
// ---------------------------------------------------------------------------

describe("getSessionPanels", () => {
  it("groups pending optimistic clips by session", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
      makeSession({ id: sid("s2"), displayNumber: 2 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s2") }),
      makeOptimisticClip({ frontendId: id("c3"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(2);
    expect(panels[0]!.sessionId).toBe(sid("s2"));
    expect(panels[0]!.pendingClips.map((c) => c.frontendId)).toEqual([
      id("c2"),
    ]);
    expect(panels[1]!.sessionId).toBe(sid("s1"));
    expect(panels[1]!.pendingClips.map((c) => c.frontendId)).toEqual([
      id("c1"),
      id("c3"),
    ]);
  });

  it("excludes non-recording sessions with no pending clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
      makeSession({ id: sid("s2"), displayNumber: 2, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
  });

  it("excludes shouldArchive optimistic clips from pending", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({
        frontendId: id("c2"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(1);
    expect(panels[0]!.pendingClips[0]!.frontendId).toBe(id("c1"));
  });

  it("ignores non-optimistic items", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeChapter(id("s1"), "Intro"),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(1);
  });

  it("returns empty array when no sessions exist", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
    ];
    expect(getSessionPanels(items, [])).toEqual([]);
  });

  it("includes archived optimistic clips in archivedClips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({
        frontendId: id("c1"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(1);
    expect(panels[0]!.archivedClips[0]!.frontendId).toBe(id("c1"));
  });

  it("includes archived ClipOnDatabase clips in archivedClips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeClipOnDatabase({
        frontendId: id("c1"),
        shouldArchive: true,
        sessionId: sid("s1"),
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(1);
    expect(panels[0]!.archivedClips[0]!.frontendId).toBe(id("c1"));
  });

  it("shows session with both pending and archived clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({
        frontendId: id("c2"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
      makeClipOnDatabase({
        frontendId: id("c3"),
        shouldArchive: true,
        sessionId: sid("s1"),
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(1);
    expect(panels[0]!.pendingClips[0]!.frontendId).toBe(id("c1"));
    expect(panels[0]!.archivedClips).toHaveLength(2);
    expect(panels[0]!.archivedClips.map((c) => c.frontendId)).toEqual([
      id("c2"),
      id("c3"),
    ]);
  });

  it("excludes non-recording sessions with no pending or archived clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
      makeSession({ id: sid("s2"), displayNumber: 2, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
  });

  it("ignores ClipOnDatabase without shouldArchive (main timeline clips)", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.archivedClips).toHaveLength(0);
    expect(panels[0]!.pendingClips).toHaveLength(1);
  });

  it("sorts panels by display number (newest first)", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s2"), displayNumber: 2 }),
      makeSession({ id: sid("s1"), displayNumber: 1 }),
      makeSession({ id: sid("s3"), displayNumber: 3 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s2") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s1") }),
      makeOptimisticClip({ frontendId: id("c3"), sessionId: sid("s3") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels.map((p) => p.displayNumber)).toEqual([3, 2, 1]);
  });

  it("derives isRecording from session status", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "recording" }),
      makeSession({ id: sid("s2"), displayNumber: 2, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s2") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels[0]!.isRecording).toBe(false);
    expect(panels[1]!.isRecording).toBe(true);
  });

  it("includes done sessions with orphaned optimistic clips in archivedClips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({
        frontendId: id("c1"),
        sessionId: sid("s1"),
        isOrphaned: true,
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(1);
    expect(
      (panels[0]!.archivedClips[0] as ClipOptimisticallyAdded).isOrphaned
    ).toBe(true);
  });

  it("includes recording sessions even with no clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "recording" }),
    ];
    const items: TimelineItem[] = [];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
    expect(panels[0]!.isRecording).toBe(true);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(0);
  });

  it("includes polling sessions with no clips (waiting for clip after recording stopped)", () => {
    // Bug #698: session disappears between recording-stopped and first clip arriving
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "polling" }),
    ];
    const items: TimelineItem[] = [];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
    expect(panels[0]!.isRecording).toBe(false);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(0);
  });

  it("excludes done sessions with no clips", () => {
    // Only polling and recording should show with no clips; done sessions should not
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
    ];
    const items: TimelineItem[] = [];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(0);
  });
});
