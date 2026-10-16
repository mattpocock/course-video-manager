import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontendId } from "./clip-state-reducer";
import { canStop } from "./cvm-recorder-reducer";
import {
  archived,
  cvm,
  cvmAdapter,
  dbClip,
  editor,
  frontendIdOf,
  recordingSession,
  settle,
  shown,
  status,
  stopped,
} from "./recorder-takes-test-harness";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a take on the CVM recorder", () => {
  const recorder = cvm;
  it("shows the take as an Optimistic Clip at the insertion point, filled in where it stands and saved there", async () => {
    const e = editor(["a", "b"]);
    const r = recorder.connect(e);
    e.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    r.startRecording();

    r.startTake();
    expect(shown(e)).toEqual(["a", "optimistically-added", "b"]);

    await r.saveTake("c1");
    expect(shown(e)).toEqual(["a", "c1", "b"]);
    expect(e.database()).toEqual(["a", "c1", "b"]);
    expect(e.clips.getState().insertionPoint).toEqual({
      type: "after-clip",
      frontendClipId: frontendIdOf(e, "c1"),
    });
  });

  it("Stream Deck delete during a take archives that take, not the Clip before it, and keeps its Footage", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();

    e.send({ type: "delete-latest-inserted-clip" });
    expect(shown(e)).toEqual(["a"]);
    expect(e.clips.getEffects().map((x) => x.type)).not.toContain(
      "archive-clips"
    );

    // The take is saved anyway, and arrives archived: never deleted.
    await r.saveTake("c1");
    expect(shown(e)).toEqual(["a"]);
    expect(archived(e)).toEqual(["c1"]);
    expect(e.database()).toEqual(["a"]);
  });

  it("restores a take deleted mid-take in place, and the next take lands at the insertion point", async () => {
    const e = editor(["a", "b"]);
    const r = recorder.connect(e);
    e.send({ type: "set-insertion-point-after", clipId: "f-a" as FrontendId });
    r.startRecording();

    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });
    await r.saveTake("c1");

    r.startTake();
    await r.saveTake("c2");
    expect(shown(e)).toEqual(["a", "c2", "b"]);
    expect(e.database()).toEqual(["a", "c2", "b"]);

    e.send({ type: "restore-clip", clipId: frontendIdOf(e, "c1") });
    expect(e.clips.getEffects().at(-1)).toEqual({
      type: "unarchive-clips",
      clipIds: ["c1"],
    });
    expect(shown(e)).toEqual(e.database());
  });

  it("restoring a take before it is saved means it is saved live", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });

    const take = e.clips.getState().items[1]!;
    e.send({ type: "restore-clip", clipId: take.frontendId });
    await r.saveTake("c1");

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
    expect(e.clips.getEffects().map((x) => x.type)).not.toContain(
      "archive-clips"
    );
  });

  // #2163: a Clip deleted mid-take, then more speech, a Stop and a new take.
  it("after a take deleted mid-take, every later take saves where the editor shows it, through Stop and the next Recording Session", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    e.send({ type: "delete-latest-inserted-clip" });
    await r.saveTake("c1");
    expect(archived(e)).toEqual(["c1"]);

    r.startTake();
    await r.saveTake("c2");
    r.startTake();
    await r.saveTake("c3");
    expect(shown(e)).toEqual(["a", "c2", "c3"]);

    r.stopRecording();
    expect(e.clips.getState().sessions.map((s) => s.status)).toEqual(["done"]);

    r.startRecording(2);
    r.startTake();
    await r.saveTake("c4");
    expect(shown(e)).toEqual(["a", "c2", "c3", "c4"]);
    expect(e.database()).toEqual(["a", "c2", "c3", "c4"]);
    expect(archived(e)).toEqual(["c1"]);
  });

  it("a saved take deleted straight after, then more speech, saves the next take where the editor shows it", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    await r.saveTake("c1");
    e.send({ type: "delete-latest-inserted-clip" });
    expect(archived(e)).toEqual(["c1"]);

    r.startTake();
    await r.saveTake("c2");
    expect(shown(e)).toEqual(["a", "c2"]);
    expect(e.database()).toEqual(["a", "c2"]);
  });

  it("a take whose speech made no Clip is orphaned once the recording stops", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    r.stopRecording();

    expect(e.clips.getState().items[1]).toMatchObject({
      type: "optimistically-added",
      isOrphaned: true,
    });
    expect(e.database()).toEqual(["a"]);
  });
  // #2200: OBS left the window open, so the take lost the diagram on screen.
  it("Stop mid-take closes the take's audio window, as the silence after it would", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    r.stopRecording();

    expect(e.clips.getState().recordingClipFrontendId).toBeNull();
    expect(e.clips.getState().items[1]).toHaveProperty("pendingSnapshot");
  });

  it("the speech goes from silence, to speaking, to a Take at the minimum Clip length, and back to silence", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    expect(r.speech()).toEqual({ type: "silence" });

    r.speak();
    expect(r.speech()).toEqual({ type: "speaking-detected" });
    expect(shown(e)).toEqual(["a"]);

    r.holdSpeech();
    expect(r.speech()).toMatchObject({
      type: "long-enough-speaking-for-clip-detected",
    });
    expect(shown(e)).toEqual(["a", "optimistically-added"]);

    await r.saveTake("c1");
    expect(r.speech()).toEqual({ type: "silence" });
    expect(shown(e)).toEqual(["a", "c1"]);
  });

  it("speech too short for a Clip makes no Take, and the next Take fills its own", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.speak();
    r.endSpeech();
    expect(shown(e)).toEqual(["a"]);

    r.startTake();
    await r.saveTake("c1");
    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
  });

  it("a Record the AV Calibration gate refuses never becomes a Recording Session, and its speech makes no Take", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.refusedRecord();
    r.startTake();

    expect(e.clips.getState().sessions).toEqual([]);
    expect(shown(e)).toEqual(["a"]);
  });

  it("a page that opens mid-take asks the Recorder to stop it, once", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e, { midTake: true });
    expect(r.stops()).toBe(1);
  });

  it("a Recording Session started after the page opened is never stopped by the editor", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();
    await r.saveTake("c1");
    expect(r.stops()).toBe(0);
  });

  // #2198: only leaving the page, or Stop, stops a take.
  it("a reconnect mid-take re-attaches to it: nothing stops, and the Take saves in place", async () => {
    const e = editor(["a"]);
    const r = recorder.connect(e);
    r.startRecording();
    r.startTake();

    r.reconnect();
    expect(r.stops()).toBe(0);
    await r.saveTake("c1");

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
    expect(e.clips.getState().sessions.map((s) => s.status)).toEqual([
      "recording",
    ]);
  });
});

describe("the CVM recorder's adapter", async () => {
  const SESSION = recordingSession(1);

  it("saves the last take of a Recording Session in its place when the app server says it stopped first", async () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    // Opened idle; then a Stream Deck Record.
    adapter.hear(status(null));
    adapter.hear(status(SESSION));
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    adapter.take(SESSION);
    expect(adapter.recorder.getState().phase).toBe("recording");

    adapter.hear(status(null));
    adapter.willSave("c1");
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    adapter.hear(stopped(SESSION));
    await settle();

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
    expect(adapter.recorder.getState().phase).toBe("idle");
  });

  it("shows no Optimistic Clip for an 'um' the recorder never called a Take, and the next take fills its own", async () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear({
      type: "recording-started",
      recordingSessionId: SESSION,
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    // The um: speech, then silence, and no take-started.
    adapter.hear({ type: "speech-started", recordingSessionId: SESSION });
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    expect(e.clips.getState().items.map((i) => i.type)).toEqual([
      "on-database",
    ]);
    expect(
      adapter.recorder.getEffects().filter((x) => x.type === "place-take")
    ).toEqual([]);

    adapter.take(SESSION);
    expect(e.clips.getState().items.map((i) => i.type)).toEqual([
      "on-database",
      "optimistically-added",
    ]);
    adapter.willSave("c1");
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    await settle();
    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.database()).toEqual(["a", "c1"]);
  });

  it("shows Clips the app server saved without the editor in their take", async () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear({
      type: "recording-started",
      recordingSessionId: SESSION,
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    adapter.take(SESSION);
    // The editor's answer never arrived: saved after the Video's last item.
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    adapter.hear({
      type: "clips-saved",
      recordingSessionId: SESSION,
      clips: [e.save("c1", { type: "after-clip", databaseClipId: "a" })],
      transcriptionJobId: "job-c1",
    });

    expect(shown(e)).toEqual(["a", "c1"]);
    expect(e.clips.getEffects()).toContainEqual({
      type: "transcribe-clips",
      jobId: "job-c1",
      clipIds: ["c1"],
    });
  });

  it("leaves an old Recording Session's late events alone: the current take is untouched (#2163)", async () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear(status(SESSION));
    adapter.hear(stopped(SESSION));
    const old = recordingSession(1);
    const current = recordingSession(2);
    adapter.hear({
      type: "recording-started",
      recordingSessionId: current,
      silenceLength: "short",
      micFile: "mic.mkv",
    });
    adapter.hear({ type: "warmed-up", recordingSessionId: current });
    adapter.take(current);
    const take = e.clips.getState().items.at(-1)!;
    const before = e.clips.getEffects().length;

    adapter.willSave("never");
    adapter.take(old);
    adapter.hear({ type: "speech-ended", recordingSessionId: old });
    adapter.hear({
      type: "clips-saved",
      recordingSessionId: old,
      clips: [dbClip("late")],
      transcriptionJobId: "job-late",
    });
    adapter.hear(stopped(old));
    await settle();

    expect(e.clips.getEffects().length).toBe(before);
    expect(e.clips.getState().items.at(-1)).toEqual(take);
    expect(adapter.recorder.getState()).toMatchObject({
      phase: "recording",
      recordingSessionId: current,
    });
  });

  // #2182: a refresh mid-take stops it.
  it("stops a Recording Session already going when it loads, and still places its last take", async () => {
    const e = editor(["a", "b"]);
    const adapter = cvmAdapter(e);
    adapter.hear(status(SESSION));
    const stops = () =>
      adapter.recorder.getEffects().filter((x) => x.type === "stop-recording")
        .length;
    expect(stops()).toBe(1);
    expect(adapter.recorder.getState().phase).toBe("stopping");
    expect(e.clips.getState().sessions).toMatchObject([
      { status: "recording", outputPath: SESSION },
    ]);
    // A reconnect's status stops nothing more and starts nothing new.
    adapter.hear(status(SESSION));
    expect(stops()).toBe(1);
    expect(e.clips.getState().sessions).toHaveLength(1);

    // The speech heard before the stop landed is saved where the editor says.
    adapter.hear({ type: "warmed-up", recordingSessionId: SESSION });
    adapter.take(SESSION);
    adapter.willSave("c");
    adapter.hear({ type: "speech-ended", recordingSessionId: SESSION });
    adapter.hear(status(null));
    adapter.hear(stopped(SESSION));
    await settle();

    expect(shown(e)).toEqual(["a", "b", "c"]);
    expect(e.database()).toEqual(["a", "b", "c"]);
    expect(adapter.recorder.getState().phase).toBe("idle");
  });

  it("does not stop a Recording Session that starts after it loads, through a reconnect", async () => {
    const e = editor(["a"]);
    const adapter = cvmAdapter(e);
    adapter.hear(status(null));
    adapter.hear(status(SESSION));
    adapter.hear(status(SESSION));
    expect(
      adapter.recorder.getEffects().some((x) => x.type === "stop-recording")
    ).toBe(false);
    expect(canStop(adapter.recorder.getState())).toBe(true);
  });
});
