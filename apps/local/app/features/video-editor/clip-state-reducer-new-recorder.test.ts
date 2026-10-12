import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import type { NewRecorderMessage } from "./new-recorder-wire";

/**
 * The clip reducer on a New recorder Video: the app server's messages arrive
 * as facts, and the Clips shown are the saved Clips, where they were saved.
 */

const SESSION = "session-1";

const saved = (id: string): ClipOnDatabase =>
  fromPartial({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
  });

type SavedClip = Extract<
  NewRecorderMessage,
  { type: "clips-saved" }
>["clips"][number];

const dbClip = (id: string): SavedClip =>
  fromPartial({
    id: id as DatabaseId,
    videoFilename: "/mnt/d/r/mic.mkv",
    sourceStartTime: 2.15,
    sourceEndTime: 5.23,
    pauseType: "none",
    zoomType: "none",
    diagramSnapshotId: null,
    transcriptionStatus: "queued",
  });

const heard = (message: NewRecorderMessage) =>
  ({
    type: "new-recorder-message-heard",
    message,
    receivedAt: 1_000,
  }) as const;

const recordingStarted = heard({
  type: "recording-started",
  recordingSessionId: SESSION,
  silenceLength: "short",
  micFile: "/mnt/d/r/mic.mkv",
});

const recorderStatus = (recordingSessionId: string | null) =>
  heard({
    type: "recorder-status",
    reachable: true,
    problem: null,
    recordingSessionId,
  });

const clipsSaved = (
  ids: string[],
  placedAt: Extract<NewRecorderMessage, { type: "clips-saved" }>["placedAt"]
) =>
  heard({
    type: "clips-saved",
    recordingSessionId: SESSION,
    clips: ids.map(dbClip),
    placedAt,
    transcriptionJobId: "job-1",
  });

const tester = (items: ClipOnDatabase[] = []) =>
  new ReducerTester(clipStateReducer, {
    clipIdsWithTranscriptWords: new Set<DatabaseId>(),
    items,
    insertionPoint: { type: "end" },
    insertionOrder: 0,
    error: null,
    sessions: [],
    clipTranscriptionJobs: {},
    jobEventCursor: 0,
  });

const databaseIds = (t: ReturnType<typeof tester>) =>
  t
    .getState()
    .items.map((i) => (i.type === "on-database" ? i.databaseId : i.type));

describe("clip reducer on a New recorder Video", () => {
  it("shows each saved Clip as it arrives, with no Optimistic Clip and no polling", () => {
    const t = tester([saved("a")]);

    t.send(recordingStarted)
      .send(heard({ type: "speech-started", recordingSessionId: SESSION }))
      .send(heard({ type: "speech-ended", recordingSessionId: SESSION }))
      .send(clipsSaved(["c1"], { type: "after-clip", databaseClipId: "a" }))
      .send(
        heard({
          type: "recording-stopped",
          recordingSessionId: SESSION,
          errors: [],
          crashed: false,
          framesLost: { camera: 0, screen: 0 },
        })
      );

    const state = t.getState();
    expect(databaseIds(t)).toEqual(["a", "c1"]);
    expect(state.items.some((i) => i.type === "optimistically-added")).toBe(
      false
    );
    expect(state.items[1]).toMatchObject({
      sessionId: SESSION,
      transcriptionStatus: "transcribing",
    });
    expect(state.clipTranscriptionJobs).toEqual({
      c1: { jobId: "job-1", started: false },
    });
    expect(state.sessions).toMatchObject([
      { id: SESSION, status: "done", newRecorder: true },
    ]);
    // The app server enqueued the transcription; the editor asks for nothing
    // but that the recorder place Clips at its insertion point.
    expect(t.getEffects()).toEqual([
      { type: "scroll-to-insertion-point" },
      {
        type: "send-recorder-insertion-point",
        insertionPoint: { type: "after-clip", databaseClipId: "a" },
      },
      { type: "scroll-to-insertion-point" },
    ]);
  });

  it("places Clips where the server saved them, and keeps an insertion point moved meanwhile", () => {
    const t = tester([saved("a"), saved("b")]);
    t.send(recordingStarted).send({
      type: "set-insertion-point-after",
      clipId: "f-a" as FrontendId,
    });

    // The editor moved its insertion point while recording: the server hears.
    expect(t.getEffects().at(-1)).toEqual({
      type: "send-recorder-insertion-point",
      insertionPoint: { type: "after-clip", databaseClipId: "a" },
    });

    // A Clip saved where the server still pointed (after b) shows there.
    t.send(clipsSaved(["c1"], { type: "after-clip", databaseClipId: "b" }));
    expect(databaseIds(t)).toEqual(["a", "b", "c1"]);
    expect(t.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: "f-a",
    });

    // The next goes where the editor now points, and the point follows it.
    t.send(clipsSaved(["c2"], { type: "after-clip", databaseClipId: "a" }));
    expect(databaseIds(t)).toEqual(["a", "c2", "b", "c1"]);
    const c2 = t.getState().items[1]!;
    expect(t.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: c2.frontendId,
    });
  });

  it("shows a Clip heard twice once", () => {
    const t = tester();
    t.send(recordingStarted)
      .send(recordingStarted)
      .send(clipsSaved(["c1"], { type: "start" }))
      .send(clipsSaved(["c1"], { type: "start" }));

    expect(databaseIds(t)).toEqual(["c1"]);
    expect(t.getState().sessions).toHaveLength(1);
  });

  it("joins a take already recording when it opens late, and leaves it when the take ends", () => {
    const t = tester([saved("a"), saved("b")]);
    t.send(recorderStatus(SESSION));

    // It holds the take, and puts the server's next Clip at its own point.
    expect(t.getState().sessions).toMatchObject([
      { id: SESSION, status: "recording", newRecorder: true },
    ]);
    expect(t.getEffects()).toEqual([
      {
        type: "send-recorder-insertion-point",
        insertionPoint: { type: "after-clip", databaseClipId: "b" },
      },
    ]);
    t.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    expect(t.getEffects().at(-1)).toEqual({
      type: "send-recorder-insertion-point",
      insertionPoint: { type: "after-clip", databaseClipId: "a" },
    });

    // Its recording-stopped was missed too: the status still ends the take.
    t.send(recorderStatus(SESSION)).send(recorderStatus(null));
    expect(t.getState().sessions).toMatchObject([
      { id: SESSION, status: "done" },
    ]);
  });

  it("keeps showing Clips after it missed one", () => {
    const t = tester([saved("a")]);
    t.send(recordingStarted);

    // c1's clips-saved never arrived; c2 was saved after it.
    t.send(clipsSaved(["c2"], { type: "after-clip", databaseClipId: "c1" }));
    t.send(clipsSaved(["c3"], { type: "after-clip", databaseClipId: "c2" }));

    expect(databaseIds(t)).toEqual(["a", "c2", "c3"]);
    const c3 = t.getState().items[2]!;
    expect(t.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: c3.frontendId,
    });
  });

  it("leaves an OBS recording's insertion point to the OBS path", () => {
    const t = tester([saved("a")]);
    t.send({
      type: "recording-started",
      outputPath: "/obs/take.mkv",
      silenceLength: "short",
    }).send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });

    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-session-polling",
      "scroll-to-insertion-point",
    ]);
  });

  it("a recording started from the Stream Deck places its Clips where the editor points", () => {
    const t = tester([saved("a"), saved("b")]);
    // Not recording: the app server is not told yet.
    t.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    expect(t.getEffects()).toEqual([]);

    t.send(recordingStarted);
    expect(t.getEffects()).toContainEqual({
      type: "send-recorder-insertion-point",
      insertionPoint: { type: "after-clip", databaseClipId: "a" },
    });
  });

  it("Stream Deck delete last clip and add chapter work mid-recording: the next Clip goes after the chapter", () => {
    const t = tester([saved("a")]);
    t.send(recordingStarted).send(
      clipsSaved(["c1"], { type: "after-clip", databaseClipId: "a" })
    );

    t.send({ type: "delete-latest-inserted-clip" });
    expect(t.getEffects().map((e) => e.type)).toContain("archive-clips");
    expect(t.getEffects().at(-1)).toEqual({
      type: "send-recorder-insertion-point",
      insertionPoint: { type: "after-clip", databaseClipId: "a" },
    });

    t.send({ type: "add-chapter", name: "Part 2" });
    const chapter = t
      .getState()
      .items.find((i) => i.type === "chapter-optimistically-added")!;
    expect(t.getEffects().at(-1)).toMatchObject({ type: "create-chapter" });
    t.send({
      type: "chapter-created",
      frontendId: chapter.frontendId,
      databaseId: "ch1" as DatabaseId,
    });
    expect(t.getEffects().at(-1)).toEqual({
      type: "send-recorder-insertion-point",
      insertionPoint: { type: "after-chapter", chapterId: "ch1" },
    });

    t.send(clipsSaved(["c2"], { type: "after-chapter", chapterId: "ch1" }));
    expect(
      t
        .getState()
        .items.filter((i) => !("shouldArchive" in i && i.shouldArchive))
        .map((i) =>
          i.type === "on-database"
            ? i.databaseId
            : i.type === "chapter-on-database"
              ? i.name
              : i.type
        )
    ).toEqual(["a", "Part 2", "c2"]);
  });
});
