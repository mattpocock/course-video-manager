import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { startRecorderService } from "recorder-service/recorder-service";
import {
  fakeFootage,
  fakeWindows,
} from "recorder-service/test-utils/fake-windows";
import { WebSocket } from "ws";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { NewRecorderMessage } from "@/features/video-editor/new-recorder-wire";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import {
  createRecorderClient,
  type RecorderClientOptions,
} from "./client.server";
import {
  ingestRecorderEvent,
  unfinishedRecordingSessions,
} from "./ingest.server";

/**
 * End to end, without hardware: the real recorder service on a scripted
 * Windows (its fake ffmpeg.exe), the app server's recorder client, and the
 * database on PGlite. Record, speak, Stop: saved Clips.
 */

setupClipServiceTests();

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recorder-client-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const startService = async (stateDir = tmp()) => {
  const windows = fakeWindows();
  const service = await startRecorderService({
    port: 0,
    launch: windows.launch,
    now: () => 1_760_000_000_000,
    stateDir,
  });
  cleanups.unshift(() => service.close());
  return { windows, port: service.port, stateDir };
};

type Ingest = RecorderClientOptions["ingest"];

/** The real ingest, on PGlite. */
const saveEvent: Ingest = (event, insertionPointFor) =>
  Effect.runPromise(
    ingestRecorderEvent(testDb as never, event, insertionPointFor).pipe(
      Effect.provide(
        JobOperationsService.Default.pipe(
          Layer.provide(Layer.succeed(DrizzleService, testDb as never))
        )
      )
    )
  );

/** Where a Stream Deck Record's Recording Sessions go. */
const STREAM_DECK_FOLDER = fs.mkdtempSync(
  path.join(os.tmpdir(), "recorder-client-deck-")
);
afterAll(() => fs.rmSync(STREAM_DECK_FOLDER, { recursive: true, force: true }));

/** The app server's recorder client, as live.server.ts makes it. */
const connectClient = (port: number, ingest: Ingest = saveEvent) => {
  const client = createRecorderClient({
    url: `ws://127.0.0.1:${port}`,
    ingest,
    unfinishedRecordingSessions: () =>
      Effect.runPromise(unfinishedRecordingSessions(testDb as never)),
    reconnectMs: 50,
    commandTimeoutMs: 5_000,
    closeGraceMs: 50,
    retryMs: 20,
    folder: STREAM_DECK_FOLDER,
  });
  cleanups.unshift(() => client.close());
  return client;
};

const setup = async (ingest?: Ingest) => {
  const { windows, port, stateDir } = await startService();
  return { windows, client: connectClient(port, ingest), port, stateDir };
};

const readSession = () => testDb.query.recordingSessions.findFirst();

const recordOn = async (client: ReturnType<typeof connectClient>) => {
  const video = await clipService.createVideo("new recorder");
  client.subscribe(video.id, () => {});
  await vi.waitFor(() =>
    client.startRecording(video.id, {
      silenceLength: "short",
      insertionPoint: { type: "start" },
      folder: tmp(),
    })
  );
  return video;
};

/** The camera's speech detector hears speech over each [from, to]. */
const speak = (
  camera: { stderr: (text: string) => void },
  ...takes: [number, number][]
) => {
  for (const [from, to] of takes) {
    camera.stderr(
      `[silencedetect @ 1] silence_end: ${from} | silence_duration: 1\r\n`
    );
    camera.stderr(`[silencedetect @ 1] silence_start: ${to}\r\n`);
  }
};

const clipTimes = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((i) =>
    i.type === "clip" ? [[i.data.sourceStartTime, i.data.sourceEndTime]] : []
  );

describe("the recorder client", () => {
  it("records on a New recorder Video: scene, Record, speech, Stop yields saved Clips, live", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("new recorder");
    const heard: NewRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    expect(heard).toContainEqual({ type: "scene-changed", scene: "Code" });

    await client.switchScene(video.id, "Camera");
    expect(heard.at(-1)).toEqual({ type: "scene-changed", scene: "Camera" });

    await client.startRecording(video.id, {
      silenceLength: "short",
      insertionPoint: { type: "start" },
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
    const session = await testDb.query.recordingSessions.findFirst();
    expect(session).toMatchObject({ videoId: video.id, status: "stopped" });
  });

  it("opens the recorder, and the Cam Link, only while an editor listens on the Video", async () => {
    const { windows, client } = await setup();
    expect(windows.camerasRunning()).toBe(0);

    const heard: NewRecorderMessage[] = [];
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
    const video = await clipService.createVideo("new recorder");
    client.subscribe(video.id, () => {});
    await vi.waitFor(() =>
      expect(
        client.startRecording(video.id, {
          silenceLength: "short",
          insertionPoint: { type: "start" },
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
      reconnectMs: 1_000,
      commandTimeoutMs: 1_000,
      closeGraceMs: 0,
      folder: "/tmp",
      retryMs: 0,
    });
    cleanups.push(() => client.close());

    await expect(
      client.startRecording("v1", {
        silenceLength: "short",
        insertionPoint: { type: "start" },
        folder: "/tmp",
      })
    ).rejects.toThrow("The recorder service is not running");
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
    const deck = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => deck.once("open", r));
    deck.send(JSON.stringify({ type: "stop" }));
    cleanups.unshift(() => deck.close());
    await vi.waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect((await health.json()).state.kind).toBe("open");
    });

    connectClient(port);
    await vi.waitFor(async () =>
      expect((await readSession())?.status).toBe("stopped")
    );
  });

  it("saves a take whose save failed, in its place, by asking for it again", async () => {
    let failed = false;
    const { windows, client } = await setup((event, insertionPointFor) => {
      if (event.type === "speech-ended" && !failed) {
        failed = true;
        return Promise.reject(new Error("the database blinked"));
      }
      return saveEvent(event, insertionPointFor);
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

  it("puts the next take where the editor moved the insertion point to while a take was saving", async () => {
    let release!: () => void;
    const placedAt: unknown[] = [];
    const { windows, client } = await setup(
      async (event, insertionPointFor) => {
        if (event.type !== "speech-ended")
          return { videoId: null, messages: [], insertionPoint: null };
        placedAt.push(insertionPointFor("v1"));
        if (placedAt.length === 1)
          await new Promise<void>((r) => (release = r));
        return {
          videoId: "v1",
          messages: [],
          insertionPoint: { type: "after-clip", databaseClipId: "clip-1" },
        };
      }
    );
    client.subscribe("v1", () => {});
    await vi.waitFor(() =>
      client.startRecording("v1", {
        silenceLength: "short",
        insertionPoint: { type: "start" },
        folder: tmp(),
      })
    );
    const camera = windows.recorder("camera");
    camera.stderr("[silencedetect @ 1] silence_start: -0.0001\r\n");
    speak(camera, [2, 5]);
    await vi.waitFor(() => expect(placedAt).toHaveLength(1));

    client.setInsertionPoint("v1", { type: "after-chapter", chapterId: "Q" });
    release();
    speak(camera, [7, 10]);

    await vi.waitFor(() => expect(placedAt).toHaveLength(2));
    expect(placedAt[1]).toEqual({ type: "after-chapter", chapterId: "Q" });
  });

  it("records from the Stream Deck with the editor's Silence Length, and the editor hears it as its own Record", async () => {
    const { client, port } = await setup();
    const video = await clipService.createVideo("new recorder");
    const heard: NewRecorderMessage[] = [];
    client.subscribe(video.id, (m) => heard.push(m));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    const deck = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => deck.once("open", r));
    cleanups.unshift(() => deck.close());
    const press = (action: "record" | "stop") =>
      deck.send(JSON.stringify({ type: "stream-deck", press: { action } }));

    // The editor has not said its Silence Length: the press does nothing.
    press("record");
    await vi.waitFor(() =>
      expect(heard.at(-1)).toMatchObject({
        type: "recorder-failed",
        message: expect.stringContaining("Stream Deck"),
      })
    );

    client.setSilenceLength(video.id, "long");
    press("record");
    await vi.waitFor(() =>
      expect(heard).toContainEqual(
        expect.objectContaining({
          type: "recording-started",
          silenceLength: "long",
          micFile: expect.stringContaining(STREAM_DECK_FOLDER),
        })
      )
    );
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
