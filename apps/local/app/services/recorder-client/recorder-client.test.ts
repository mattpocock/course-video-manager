import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fakeFootage } from "recorder-service/test-utils/fake-windows";
import { Effect } from "effect";
import {
  connect,
  FAKE_MIC,
  T0_MS,
} from "recorder-service/test-utils/service-harness";
import {
  CALIBRATION_REFUSAL_PREFIX,
  CALIBRATION_VALIDITY_MS,
  deriveThreshold,
} from "@/av-calibration-constants";
import { requireFreshAVCalibration } from "../av-calibration.server";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import type {
  CvmRecorderMessage,
  PlacedTake,
} from "@/features/video-editor/cvm-recorder-wire";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { avCalibrations } from "@/db/schema";
import { createRecorderClient } from "./client.server";

import {
  clipTimes,
  connectClient,
  readSession,
  recordOn,
  saveEvent,
  speak,
  startService,
  STREAM_DECK_FOLDER,
  tmp,
  calibrationFromDatabase,
  trackedCalibration,
  startServiceAndClient as setup,
} from "./recorder-client-test-harness";

/**
 * End to end, without hardware (recorder-client-test-harness.ts): Record, speak, Stop:
 * saved Clips.
 */

setupClipServiceTests();

describe("the recorder client", () => {
  it("records on a CVM recorder Video: scene, Record, speech, Stop yields saved Clips, live", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    expect(heard).toContainEqual({ type: "scene-changed", scene: "Code" });

    await client.switchScene(video.id, "Camera");
    expect(heard.at(-1)).toEqual({ type: "scene-changed", scene: "Camera" });

    await client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    });
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 2 | silence_duration: 2\r\n"
    );
    camera.stderr("[silencedetect @ 1] silence_start: 5\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 7 | silence_duration: 2\r\n"
    );
    camera.stderr("[silencedetect @ 1] silence_start: 10\r\n");

    // Clips arrive while still recording, already saved.
    await vi.waitFor(async () =>
      expect(
        (await clipService.getTimeline(video.id)).filter(
          (i) => i.type === "clip"
        )
      ).toHaveLength(2)
    );

    await client.stopRecording(video.id);
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("recording-stopped")
    );

    const clips = (await clipService.getTimeline(video.id)).flatMap((i) =>
      i.type === "clip" ? [i.data] : []
    );
    expect(
      clips.map((c) => [
        c.sourceStartTime,
        c.sourceEndTime,
        c.videoFilename,
        c.scene,
      ])
    ).toEqual([
      [2.15, 5.23, expect.stringMatching(/mic\.mkv$/), "Camera"],
      [7.15, 10.23, expect.stringMatching(/mic\.mkv$/), "Camera"],
    ]);
    expect(
      (await testDb.query.recordingSessionSceneEvents.findMany()).map((e) => [
        e.fileTime,
        e.scene,
      ])
    ).toEqual([[0, "Camera"]]);
    const saved = heard.filter((m) => m.type === "clips-saved");
    expect(saved.flatMap((m) => m.clips.map((c) => c.id))).toEqual(
      clips.map((c) => c.id)
    );
    // What the editor (and so the glass) hears of silence detection, in order.
    expect(
      heard
        .map((m) => m.type)
        .filter(
          (t) =>
            t === "warmed-up" || t === "take-started" || t.startsWith("speech-")
        )
    ).toEqual([
      "warmed-up",
      "speech-started",
      "take-started",
      "speech-ended",
      "speech-started",
      "take-started",
      "speech-ended",
    ]);
    const session = await testDb.query.recordingSessions.findFirst();
    expect(session).toMatchObject({ videoId: video.id, status: "stopped" });
  });

  it("opens the recorder, and the Cam Link, only while an editor listens on the Video", async () => {
    const { windows, client } = await setup();
    expect(windows.camerasRunning()).toBe(0);

    const heard: CvmRecorderMessage[] = [];
    const unsubscribe = client.subscribe("video-1", (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    expect(windows.camerasRunning()).toBe(1);
    expect(heard).toContainEqual(
      expect.objectContaining({
        type: "recorder-status",
        previews: {
          camera: expect.stringMatching(
            /^http:\/\/127\.0\.0\.1:\d+\/preview\/camera$/
          ),
          screen: expect.stringMatching(/\/preview\/screen$/),
        },
        still: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/still$/),
      })
    );

    unsubscribe();
    await vi.waitFor(() => expect(windows.camerasRunning()).toBe(0));
  });

  it("refuses Record with the recorder's reason", async () => {
    const { client } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    client.subscribe(video.id, () => {});
    await vi.waitFor(() =>
      expect(
        client.startRecording(video.id, {
          silenceLength: "short",
          folder: "relative/folder",
        })
      ).rejects.toThrow("The folder must be an absolute path")
    );
  });

  it("says so when the recorder service is not running", async () => {
    const client = createRecorderClient({
      url: "ws://127.0.0.1:9",
      ingest: () => Promise.reject(new Error("unused")),
      unfinishedRecordingSessions: () => Promise.resolve([]),
      calibration: () => Promise.reject(new Error("unused")),
      reconnectMs: 1_000,
      commandTimeoutMs: 1_000,
      closeGraceMs: 0,
      folder: "/tmp",
      retryMs: 0,
      placeTimeoutMs: 0,
    });
    try {
      await expect(
        client.startRecording("v1", {
          silenceLength: "short",
          folder: "/tmp",
        })
      ).rejects.toThrow("The recorder service is not running");
    } finally {
      client.close();
    }
  });

  it("marks a Recording Session crashed when the recorder service comes back after dying mid-take, keeping every take", async () => {
    const { windows, client, stateDir } = await setup();
    const video = await recordOn(client);
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 2 | silence_duration: 2\r\n"
    );
    camera.stderr("[silencedetect @ 1] silence_start: 5\r\n");
    camera.stderr(
      "[silencedetect @ 1] silence_end: 7 | silence_duration: 2\r\n"
    );
    await vi.waitFor(async () =>
      expect(await clipTimes(video.id)).toHaveLength(1)
    );

    // The service dies mid-take, leaving its files unfinished; the app
    // server goes with it.
    const session = await readSession();
    fs.writeFileSync(
      session!.cameraFilePath,
      fakeFootage(12, { unfinished: true })
    );
    fs.writeFileSync(
      session!.screenFilePath,
      fakeFootage(12, { unfinished: true })
    );
    fs.writeFileSync(
      session!.micFilePath,
      fakeFootage(12, { unfinished: true })
    );
    client.close();

    const restarted = await startService(stateDir);
    connectClient(restarted.port);

    await vi.waitFor(async () =>
      expect((await readSession())?.status).toBe("crashed")
    );
    expect(await clipTimes(video.id)).toEqual([
      [2.15, 5.23],
      [7.15, 12.23],
    ]);
  });

  it("catches up on a stop it missed while the app server was down", async () => {
    const { client, port } = await setup();
    await recordOn(client);
    client.close();

    // Stopped from elsewhere (the Stream Deck) while no app server listened.
    const deck = await connect(port);
    deck.send({ type: "stop" });
    await vi.waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect((await health.json()).state.kind).toBe("open");
    });

    connectClient(port);
    await vi.waitFor(async () =>
      expect((await readSession())?.status).toBe("stopped")
    );
  });

  it("saves a take filmed wholly from the Stream Deck while the app server was down", async () => {
    const calibration = trackedCalibration();
    const { windows, client, port } = await setup(undefined, calibration.read);
    const video = await clipService.createVideo("CVM recorder");
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    client.setSilenceLength(video.id, "short");
    await client.settled();
    await calibration.settled();
    const deck = await connect(port);
    const health = async () =>
      (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).state;
    client.close();

    deck.send({ type: "stream-deck", press: { action: "record" } });
    await vi.waitFor(async () =>
      expect((await health()).kind).toBe("recording")
    );
    speak(windows.recorder("camera"), [2, 5]);
    deck.send({ type: "stream-deck", press: { action: "stop" } });
    await vi.waitFor(async () => expect((await health()).kind).toBe("open"));

    connectClient(port);
    await vi.waitFor(async () => {
      expect((await readSession())?.status).toBe("stopped");
      expect(await clipTimes(video.id)).toHaveLength(1);
    });
  });

  it("saves a take whose save failed, in its place, by asking for it again", async () => {
    let failed = false;
    const { windows, client } = await setup((event, askEditor) => {
      if (event.type === "speech-ended" && !failed) {
        failed = true;
        return Promise.reject(new Error("the database blinked"));
      }
      return saveEvent(event, askEditor);
    });
    const video = await recordOn(client);
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    speak(camera, [2, 5], [7, 10]);

    await vi.waitFor(async () =>
      expect(await clipTimes(video.id)).toEqual([
        [2.15, 5.23],
        [7.15, 10.23],
      ])
    );
  });

  it("saves each take where the editor says when the speech ends, and answers it with the Clips", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    const [first] = await clipService.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      items: [],
      clips: [
        { inputVideo: "first.mp4", startTime: 0, endTime: 1 },
        { inputVideo: "last.mp4", startTime: 0, endTime: 1 },
      ],
    });
    const heard: CvmRecorderMessage[] = [];
    const answers: Promise<PlacedTake>[] = [];
    client.subscribe(video.id, (m) => {
      heard.push(m);
      if (m.type === "speech-ended")
        answers.push(
          client.placeTake(video.id, m.recordingSessionId, {
            type: "after-clip",
            databaseClipId: first!.id,
          })
        );
    });
    await vi.waitFor(() =>
      client.startRecording(video.id, { silenceLength: "short", folder: tmp() })
    );
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    speak(camera, [2, 5]);

    await vi.waitFor(() => expect(answers).toHaveLength(1));
    const placed = await answers[0]!;
    expect(placed.clips.map((c) => c.sourceStartTime)).toEqual([2.15]);
    expect(
      (await clipService.getTimeline(video.id)).flatMap((i) =>
        i.type === "clip" ? [i.data.videoFilename] : []
      )
    ).toEqual(["first.mp4", expect.stringMatching(/mic\.mkv$/), "last.mp4"]);
    expect(heard.map((m) => m.type)).not.toContain("clips-saved");
    // Asked again for the same speech (another tab), nothing waits.
    expect(
      await client.placeTake(video.id, placed.clips[0]!.recordingSessionId!, {
        type: "start",
      })
    ).toEqual({ clips: [], transcriptionJobId: null });
  });

  it("records from the Stream Deck with the editor's Silence Length, and the editor hears it as its own Record", async () => {
    const { client, port } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    const deck = await connect(port);
    const press = (action: "record" | "stop") =>
      deck.send({ type: "stream-deck", press: { action } });

    // The editor has not said its Silence Length: the press does nothing.
    press("record");
    await vi.waitFor(() =>
      expect(heard.at(-1)).toMatchObject({
        type: "recorder-failed",
        message: expect.stringContaining("Stream Deck"),
      })
    );

    client.setSilenceLength(video.id, "long");
    // Pressed until the recorder is prepared (the threshold is read first).
    await vi.waitFor(() => {
      press("record");
      expect(heard).toContainEqual(
        expect.objectContaining({
          type: "recording-started",
          silenceLength: "long",
          micFile: expect.stringContaining(STREAM_DECK_FOLDER),
        })
      );
    });
    press("stop");
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("recording-stopped")
    );
    expect(await readSession()).toMatchObject({
      videoId: video.id,
      silenceLength: "long",
      status: "stopped",
    });
  });
});

/**
 * A stored AV Calibration, taken `minutesBefore` the recorder service's
 * clock, on its mic, passing today's rules unless told otherwise.
 */
const calibrated = (
  id: string,
  o: {
    minutesBefore: number;
    outcome?: "passed" | "failed";
    speechLufs?: number;
    truePeakDb?: number | null;
    /** null: from before the clap step. */
    clapsFound?: number | null;
    recorderMic?: string;
  }
) => {
  const speechLufs = o.speechLufs ?? -27;
  return testDb.insert(avCalibrations).values({
    id,
    createdAt: new Date(T0_MS - o.minutesBefore * 60_000),
    outcome: o.outcome ?? "passed",
    noiseFloorDb: -80,
    speechLufs,
    truePeakDb: o.truePeakDb === undefined ? -10 : o.truePeakDb,
    thresholdDb: deriveThreshold(speechLufs),
    recorderMic: o.recorderMic ?? FAKE_MIC,
    scriptVersion: 3,
    micFilePath: `/calibrations/${id}/mic.wav`,
    browserTracePath: `/calibrations/${id}/browser-trace.json`,
    cameraDevice: "Cam Link 4K",
    clapsFound: o.clapsFound === undefined ? 5 : o.clapsFound,
    clapSpreadMs: o.clapsFound === null ? null : 8,
    micOffsetMs: o.clapsFound === null ? null : 142,
    cameraFilePath: `/calibrations/${id}/camera.mkv`,
  });
};

const guard = (now: number) =>
  Effect.runPromise(
    Effect.either(requireFreshAVCalibration(testDb as never, new Date(now)))
  );

describe("the recorder client, gated on the AV Calibration (ADR 0038)", () => {
  it("refuses Record with no calibration passed under today's rules (an old -21 LUFS pass, or one from before the clap step, does not count), or an expired one; allows a fresh one", async () => {
    expect(await guard(T0_MS)).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "AVCalibrationRequiredError",
        reason: { kind: "none" },
      },
    });

    // Passed under the old -21 LUFS target, before the peak check.
    await calibrated("old-rules", {
      minutesBefore: 5,
      speechLufs: -21,
      truePeakDb: null,
    });
    expect(await guard(T0_MS)).toMatchObject({
      left: { reason: { kind: "none" } },
    });

    // A good level, but from before the clap step: no Mic Offset.
    await calibrated("before-claps", { minutesBefore: 4, clapsFound: null });
    expect(await guard(T0_MS)).toMatchObject({
      left: { reason: { kind: "none" } },
    });

    await calibrated("fresh", { minutesBefore: 60 });
    expect(await guard(T0_MS)).toMatchObject({
      _tag: "Right",
      right: { id: "fresh", thresholdDb: -43 },
    });
    const sevenDaysOn = T0_MS - 60 * 60_000 + CALIBRATION_VALIDITY_MS;
    expect(await guard(sevenDaysOn)).toMatchObject({
      left: { reason: { kind: "expired", expiredAtMs: sevenDaysOn } },
    });
  });

  it("is refused by the recorder service when the calibration was taken on another mic", async () => {
    const { client } = await setup(undefined, calibrationFromDatabase);
    await calibrated("other-mic", {
      minutesBefore: 60,
      recorderMic: "Scarlett Solo USB",
    });
    const video = await clipService.createVideo("CVM recorder");
    client.subscribe(video.id, () => {});
    await vi.waitFor(() =>
      expect(
        client.startRecording(video.id, {
          silenceLength: "short",
          folder: tmp(),
        })
      ).rejects.toThrow(
        `${CALIBRATION_REFUSAL_PREFIX}The recorder's mic changed from "Scarlett Solo USB" to "${FAKE_MIC}"`
      )
    );
    expect(await readSession()).toBeUndefined();
  });

  it("records under the latest one, keeps it for the whole Recording Session, and a Stream Deck Record after a new one cuts with that", async () => {
    const { windows, client, port } = await setup(
      undefined,
      calibrationFromDatabase
    );
    await calibrated("passed-earlier", { minutesBefore: 60 });
    await calibrated("failed-later", {
      minutesBefore: 50,
      outcome: "failed",
      speechLufs: -32,
    });

    const video = await recordOn(client);
    expect(windows.recorder("camera").launch.args.join(" ")).toContain(
      "silencedetect=n=-43dB:d=0.8"
    );

    // Calibrating again mid-session changes nothing for it.
    await calibrated("passed-mid-session", {
      minutesBefore: 40,
      speechLufs: -26,
    });
    client.calibrationChanged();
    await client.stopRecording(video.id);
    await vi.waitFor(async () =>
      expect(await readSession()).toMatchObject({
        status: "stopped",
        avCalibrationId: "passed-earlier",
      })
    );

    client.setSilenceLength(video.id, "short");
    const press = await streamDeck(port);
    await vi.waitFor(async () => {
      press("record");
      expect(
        await testDb.query.recordingSessions.findFirst({
          where: (s, { eq }) => eq(s.avCalibrationId, "passed-mid-session"),
        })
      ).toBeDefined();
    });
    press("stop");
  });
});

/** A Stream Deck button, pressed on the recorder service itself. */
const streamDeck = async (port: number) => {
  const deck = await connect(port);
  return (action: "record" | "stop") =>
    deck.send({ type: "stream-deck", press: { action } });
};

const recorderState = async (port: number) =>
  (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).state;

describe("the recorder client, guarding the Stream Deck and the scene", () => {
  it("stops a Stream Deck take on a Video outside the Draft: it would never be saved", async () => {
    const { client, port } = await setup();
    const { videoIds } = await seedCourseVersion(
      testDb,
      [{ path: "01-frozen", videos: [{ description: null, clips: [] }] }],
      { commitState: "published" }
    );
    const videoId = videoIds["01-frozen/Explainer"]!;
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(videoId, (m) => heard.push(m));
    // Said while the Video was still the Draft's (a tab left open over a Publish).
    client.setSilenceLength(videoId, "short");
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    const press = await streamDeck(port);

    press("record");
    await vi.waitFor(() =>
      expect(heard).toContainEqual(
        expect.objectContaining({ type: "recorder-failed" })
      )
    );
    await vi.waitFor(async () =>
      expect((await recorderState(port)).kind).toBe("open")
    );
    expect(await readSession()).toBeUndefined();
  });

  it("tells an editor its scene again when the recorder comes back to its Video", async () => {
    const { client } = await setup();
    const a = await clipService.createVideo("a");
    const b = await clipService.createVideo("b");
    const heard: CvmRecorderMessage[] = [];
    client.subscribe(a.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );

    // Video B is opened in another tab, then closed: the recorder is A's again.
    const leaveB = client.subscribe(b.id, () => {});
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("camera-closed")
    );
    const closedAt = heard.length;
    leaveB();
    await vi.waitFor(() =>
      expect(heard.slice(closedAt)).toContainEqual({
        type: "scene-changed",
        scene: "Code",
      })
    );
  });
});
