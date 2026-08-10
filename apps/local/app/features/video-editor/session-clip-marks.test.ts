import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type ClipOptimisticallyAdded,
  type FrontendId,
  type RecordingSession,
  type SessionId,
  type TimelineItem,
} from "./clip-state-reducer";
import { getSessionClipMarks } from "./session-clip-marks";
import { ReducerTester } from "@/test-utils/reducer-tester";

const SESSION = "session-1" as SessionId;
const OLDER = "session-0" as SessionId;

const session = (id: SessionId, displayNumber: number): RecordingSession =>
  fromPartial({ id, displayNumber, status: "recording" });

const optimistic = (
  insertionOrder: number,
  overrides: Partial<ClipOptimisticallyAdded> = {}
): TimelineItem =>
  fromPartial<ClipOptimisticallyAdded>({
    type: "optimistically-added",
    frontendId: `f-${insertionOrder}` as FrontendId,
    insertionOrder,
    sessionId: SESSION,
    ...overrides,
  });

const onDatabase = (
  insertionOrder: number | null,
  overrides: Partial<ClipOnDatabase> = {}
): TimelineItem =>
  fromPartial<ClipOnDatabase>({
    type: "on-database",
    frontendId: `f-db-${insertionOrder}` as FrontendId,
    insertionOrder,
    sessionId: SESSION,
    ...overrides,
  });

describe("getSessionClipMarks", () => {
  it("reports nothing before the first recording session", () => {
    expect(getSessionClipMarks([optimistic(1)], [])).toEqual([]);
  });

  it("marks an unpaired optimistic clip as pending", () => {
    const marks = getSessionClipMarks([optimistic(1)], [session(SESSION, 1)]);
    expect(marks).toEqual(["pending"]);
  });

  it("marks a paired clip as landed", () => {
    const marks = getSessionClipMarks([onDatabase(1)], [session(SESSION, 1)]);
    expect(marks).toEqual(["landed"]);
  });

  it("marks a timed-out optimistic clip as orphaned", () => {
    const marks = getSessionClipMarks(
      [optimistic(1, { isOrphaned: true })],
      [session(SESSION, 1)]
    );
    expect(marks).toEqual(["orphaned"]);
  });

  it("reads a deleted clip as deleted rather than orphaned", () => {
    // A clip you chose to throw away not arriving is not a failure, so it must
    // not show up as one.
    const marks = getSessionClipMarks(
      [optimistic(1, { isOrphaned: true, shouldArchive: true })],
      [session(SESSION, 1)]
    );
    expect(marks).toEqual(["deleted-pending"]);
  });

  it("keeps a deleted clip's landed state once it pairs", () => {
    const marks = getSessionClipMarks(
      [onDatabase(1, { shouldArchive: true })],
      [session(SESSION, 1)]
    );
    expect(marks).toEqual(["deleted-landed"]);
  });

  it("orders marks by insertion order, not timeline position", () => {
    const marks = getSessionClipMarks(
      [onDatabase(3), optimistic(1), onDatabase(2)],
      [session(SESSION, 1)]
    );
    expect(marks).toEqual(["pending", "landed", "landed"]);
  });

  it("scopes to the newest session, so pressing record wipes the slate", () => {
    const marks = getSessionClipMarks(
      [optimistic(1, { sessionId: OLDER }), optimistic(2)],
      [session(OLDER, 1), session(SESSION, 2)]
    );
    expect(marks).toEqual(["pending"]);
  });

  it("ignores clips loaded from the database with no session", () => {
    const marks = getSessionClipMarks(
      [onDatabase(1, { sessionId: undefined }), optimistic(2)],
      [session(SESSION, 1)]
    );
    expect(marks).toEqual(["pending"]);
  });
});

describe("getSessionClipMarks over a real take", () => {
  // The display's whole premise is that a clip keeps its session when it pairs
  // with a database clip, so this pins that end to end rather than trusting the
  // two halves to agree.
  it("fills a mark in place when the database clip lands", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      fromPartial<clipStateReducer.State>({
        clipIdsBeingTranscribed: new Set(),
        items: [],
        insertionPoint: { type: "end" },
        insertionOrder: 0,
        error: null,
        sessions: [],
      })
    );

    tester
      .send({
        type: "recording-started",
        outputPath: "/tmp/recording.mkv",
        silenceLength: "short" as const,
      })
      .send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        })
      );

    const heard = tester.getState();
    expect(getSessionClipMarks(heard.items, heard.sessions)).toEqual([
      "pending",
    ]);

    tester.send({
      type: "new-database-clips",
      clips: [fromPartial({ id: "db-1", text: "Hello world" })],
    });

    const landed = tester.getState();
    expect(getSessionClipMarks(landed.items, landed.sessions)).toEqual([
      "landed",
    ]);
  });

  it("leaves a mark hollow when the backend never agrees there was a clip", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      fromPartial<clipStateReducer.State>({
        clipIdsBeingTranscribed: new Set(),
        items: [],
        insertionPoint: { type: "end" },
        insertionOrder: 0,
        error: null,
        sessions: [],
      })
    );

    tester
      .send({
        type: "recording-started",
        outputPath: "/tmp/recording.mkv",
        silenceLength: "short" as const,
      })
      .send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-1",
        })
      )
      .send(
        fromPartial({
          type: "new-optimistic-clip-detected",
          soundDetectionId: "sound-2",
        })
      );

    // Only one database clip arrives for the two the frontend heard.
    tester.send({
      type: "new-database-clips",
      clips: [fromPartial({ id: "db-1", text: "Hello world" })],
    });

    const sessionId = tester.getState().sessions[0]!.id;
    tester.send({ type: "session-polling-complete", sessionId });

    const settled = tester.getState();
    expect(getSessionClipMarks(settled.items, settled.sessions)).toEqual([
      "landed",
      "orphaned",
    ]);
  });
});
