import { describe, expect, it } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { resolveStoragePath } from "@/packages/storage/server";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { SidecarContextTest } from "@/services/sidecar-context";
import { eq } from "drizzle-orm";
import {
  recordingSessions,
  recordingSessionSceneEvents,
  videos,
} from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { transcribeAndStoreClips } from "@/services/clip-transcription.server";
import type { RecordingSessionEvent } from "recorder-service/protocol";
import type {
  CvmRecorderMessage,
  PlacedTake,
} from "@/features/video-editor/cvm-recorder-wire";
import type { InsertionPoint } from "@/services/clip-service";
import {
  setupClipServiceTests,
  clipService,
  testDb,
  start,
} from "../clip-service-test-setup";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import { ingestRecorderEvent, type AskEditor } from "./ingest.server";
import { requireRecordableVideo } from "./record-guard.server";
import { createRecorderEventSequencer } from "./sequencer";

/**
 * The app server's recorder ingest on PGlite: recorder events go in, in
 * whatever order and however often the socket delivered them, and Recording
 * Sessions and Clips come back out through the clip service.
 */

setupClipServiceTests();

const SESSION = "11111111-2222-3333-4444-555555555555";
const MIC = "/mnt/d/recordings/2026-10-11 11111111/mic.mkv";
const FILES = {
  camera: MIC.replace("mic.mkv", "camera.mkv"),
  screen: MIC.replace("mic.mkv", "screen.mkv"),
  mic: MIC,
};

const layer = () =>
  Layer.mergeAll(
    JobOperationsService.Default,
    ClipOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)));

/** Feeds events through the sequencer and ingest, as the recorder client does. */
const recorderIngest = (askEditor: AskEditor = async () => null) => {
  const sequencer = createRecorderEventSequencer();
  const messages: CvmRecorderMessage[] = [];
  const replays: { afterSeq: number }[] = [];
  const placed: PlacedTake[] = [];
  return {
    messages,
    replays,
    placed,
    feed: async (...events: RecordingSessionEvent[]) => {
      for (const event of events) {
        const { ready, replay } = sequencer.accept(event);
        if (replay) replays.push({ afterSeq: replay.afterSeq });
        for (const next of ready) {
          const result = await Effect.runPromise(
            ingestRecorderEvent(
              testDb as never,
              next,
              // As the recorder client asks: telling the editors first.
              (videoId, recordingSessionId, clip) => {
                messages.push({
                  type: "speech-ended",
                  recordingSessionId,
                  clip,
                });
                return askEditor(videoId, recordingSessionId, clip);
              }
            ).pipe(Effect.provide(layer()))
          );
          messages.push(...result.messages);
          if (result.placed) placed.push(result.placed);
        }
      }
    },
  };
};

const started = (
  videoId: string
): Extract<RecordingSessionEvent, { type: "recording-started" }> => ({
  type: "recording-started",
  seq: 1,
  recordingSessionId: SESSION,
  videoId,
  t0Ms: 1_760_000_000_000,
  silenceLength: "short",
  files: FILES,
});

const speech = (seq: number, from: number, to: number) =>
  [
    {
      type: "speech-started",
      seq,
      recordingSessionId: SESSION,
      fileTime: from,
    },
    {
      type: "speech-ended",
      seq: seq + 1,
      recordingSessionId: SESSION,
      fileTime: to,
    },
  ] satisfies RecordingSessionEvent[];

const sceneChanged = (
  seq: number,
  scene: "Camera" | "Code" | "No Face",
  fileTime: number
): RecordingSessionEvent => ({
  type: "scene-changed",
  seq,
  recordingSessionId: SESSION,
  scene,
  fileTime,
});

const sceneRows = async () =>
  (
    await testDb.query.recordingSessionSceneEvents.findMany({
      where: eq(recordingSessionSceneEvents.recordingSessionId, SESSION),
    })
  )
    .map((r) => [r.fileTime, r.scene])
    .sort(([a], [b]) => Number(a) - Number(b));

const stopped = (
  seq: number
): Extract<RecordingSessionEvent, { type: "recording-stopped" }> => ({
  type: "recording-stopped",
  seq,
  recordingSessionId: SESSION,
  reason: "requested",
  fileTime: 30,
  files: FILES,
  exitCodes: { screen: 0, camera: 0 },
  framesLost: { camera: 0, screen: 0 },
  errors: [],
});

const savedClips = async (videoId: string) =>
  (await clipService.getTimeline(videoId)).flatMap((item) =>
    item.type === "clip"
      ? [
          {
            videoFilename: item.data.videoFilename,
            sourceStartTime: item.data.sourceStartTime,
            sourceEndTime: item.data.sourceEndTime,
            recordingSessionId: item.data.recordingSessionId,
            scene: item.data.scene,
          },
        ]
      : []
  );

const readSession = () =>
  testDb.query.recordingSessions.findFirst({
    where: eq(recordingSessions.id, SESSION),
  });

describe("recorder ingest", () => {
  it("tells the editor the take warmed up, for the glass, and saves nothing for it", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(started(video.id), {
      type: "warmed-up",
      seq: 2,
      recordingSessionId: SESSION,
      fileTime: 2,
    });

    expect(ingest.messages).toContainEqual({
      type: "warmed-up",
      recordingSessionId: SESSION,
    });
    expect(await savedClips(video.id)).toEqual([]);
  });

  it("saves the Recording Session and each take as a Clip on the mic file, in picture time", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(started(video.id), ...speech(2, 2, 5));
    expect(await readSession()).toMatchObject({
      videoId: video.id,
      status: "recording",
      micFilePath: MIC,
      micOffsetMs: 150,
      silenceLength: "short",
    });

    await ingest.feed(stopped(4));

    // Mic time 2–5 s is picture time 2.15–5.15 s (the 150 ms mic offset),
    // then bounded as every Clip is: frame-snapped at 60 fps, end padded.
    expect(await savedClips(video.id)).toEqual([
      {
        videoFilename: MIC,
        sourceStartTime: 2.15,
        sourceEndTime: 5.23,
        recordingSessionId: SESSION,
        scene: "Code",
      },
    ]);
    expect((await readSession())?.status).toBe("stopped");
    expect(ingest.messages.map((m) => m.type)).toEqual([
      "recording-started",
      "speech-started",
      // Asked where (none answered), then saved after the Video's last item.
      "speech-ended",
      "clips-saved",
      "recording-stopped",
    ]);
  });

  it("drops speech shorter than the minimum Clip length", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(started(video.id), ...speech(2, 1, 1.5));

    expect(await savedClips(video.id)).toEqual([]);
    expect(ingest.messages.map((m) => m.type)).not.toContain("clips-saved");
  });

  it("asks the editor where to save each speech, saves it there, and hands it the Clips", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const [first] = await clipService.appendClips({
      videoId: video.id,
      insertionPoint: start,
      items: [],
      clips: [
        { inputVideo: "first.mp4", startTime: 0, endTime: 1 },
        { inputVideo: "last.mp4", startTime: 0, endTime: 1 },
      ],
    });
    let point: InsertionPoint = {
      type: "after-clip",
      databaseClipId: first!.id,
    };
    const asked: string[] = [];
    const ingest = recorderIngest(async (videoId, recordingSessionId) => {
      asked.push(`${videoId}:${recordingSessionId}`);
      return point;
    });

    await ingest.feed(started(video.id), ...speech(2, 2, 5));
    // The editor that said where gets the Clips back: no `clips-saved`.
    expect(ingest.messages.map((m) => m.type)).not.toContain("clips-saved");
    point = {
      type: "after-clip",
      databaseClipId: ingest.placed[0]!.clips[0]!.id,
    };
    await ingest.feed(...speech(4, 8, 10));

    expect(asked).toEqual([`${video.id}:${SESSION}`, `${video.id}:${SESSION}`]);
    expect(ingest.placed.map((p) => p.clips.length)).toEqual([1, 1]);
    expect((await savedClips(video.id)).map((c) => c.videoFilename)).toEqual([
      "first.mp4",
      MIC,
      MIC,
      "last.mp4",
    ]);
  });

  it("with no editor answering, saves after the Video's last item and says so", async () => {
    const video = await clipService.createVideo("CVM recorder");
    await clipService.appendClips({
      videoId: video.id,
      insertionPoint: start,
      items: [],
      clips: [{ inputVideo: "first.mp4", startTime: 0, endTime: 1 }],
    });
    const ingest = recorderIngest();

    await ingest.feed(started(video.id), ...speech(2, 2, 5));

    expect(ingest.placed).toEqual([]);
    expect(ingest.messages.map((m) => m.type)).toContain("clips-saved");
    expect((await savedClips(video.id)).map((c) => c.videoFilename)).toEqual([
      "first.mp4",
      MIC,
    ]);
  });

  it("saves each take once, however often or out of order its events arrive", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();
    const [s1, e1] = speech(2, 2, 5);
    const [s2, e2] = speech(4, 8, 10);

    // A gap: seq 3 is missing, so 4 and 5 wait and the gap is asked for.
    await ingest.feed(started(video.id), s1!, s2!, e2!);
    expect(await savedClips(video.id)).toEqual([]);
    expect(ingest.replays).toEqual([{ afterSeq: 2 }]);

    // The replay brings everything after seq 2 again; the live copies
    // already heard are duplicates.
    await ingest.feed(e1!, s2!, e2!, stopped(6));
    await ingest.feed(started(video.id), s1!, e1!);

    expect(
      (await savedClips(video.id)).map((c) => [
        c.sourceStartTime,
        c.sourceEndTime,
      ])
    ).toEqual([
      [2.15, 5.23],
      [8.15, 10.23],
    ]);
  });

  it("does not save a take twice when a restarted app server replays the Recording Session", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const events = [started(video.id), ...speech(2, 2, 5), stopped(4)];

    await recorderIngest().feed(...events);
    await recorderIngest().feed(...events);

    expect(await savedClips(video.id)).toHaveLength(1);
  });

  it("saves each scene change as a row, once however often it is replayed", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const events = [
      started(video.id),
      sceneChanged(2, "Code", 0),
      sceneChanged(3, "Camera", 4.25),
      stopped(4),
    ];

    await recorderIngest().feed(...events);
    await recorderIngest().feed(...events);

    expect(await sceneRows()).toEqual([
      [0, "Code"],
      [4.25, "Camera"],
    ]);
  });

  it("gives each Clip the scene in force at its start, in picture time", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(
      started(video.id),
      sceneChanged(2, "No Face", 0),
      // Switched to Camera at picture time 10. Speech heard from mic time
      // 9.9 starts at picture time 10.05 (the 150 ms mic offset): Camera.
      sceneChanged(3, "Camera", 10),
      ...speech(4, 9.9, 12),
      sceneChanged(6, "Code", 20),
      // Speech from mic 19.9 starts at picture 20.05, after the switch to
      // Code; a scene change mid-take does not change its start's scene.
      ...speech(7, 19.9, 23),
      sceneChanged(9, "Camera", 21)
    );

    expect((await savedClips(video.id)).map((c) => c.scene)).toEqual([
      "Camera",
      "Code",
    ]);
  });

  it("stores a Recording Session in raw-footage/ relative to its Storage Root, found there through the resolver", async () => {
    const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "ingest-root-"));
    const previous = process.env.STORAGE_ROOTS;
    process.env.STORAGE_ROOTS = root;
    try {
      // Where the recorder service puts it: a folder of its own under the
      // first root's raw-footage/ (recordingFolder()).
      const folder = nodePath.join(root, "raw-footage", "2026-10-13 11111111");
      nodeFs.mkdirSync(folder, { recursive: true });
      const files = {
        camera: nodePath.join(folder, "camera.mkv"),
        screen: nodePath.join(folder, "screen.mkv"),
        mic: nodePath.join(folder, "mic.mkv"),
      };
      for (const file of Object.values(files)) nodeFs.writeFileSync(file, "");
      const video = await clipService.createVideo("CVM recorder");

      await recorderIngest().feed({ ...started(video.id), files });

      const row = await testDb.query.recordingSessions.findFirst({
        where: eq(recordingSessions.id, SESSION),
      });
      expect(row).toMatchObject({
        cameraFilePath: "raw-footage/2026-10-13 11111111/camera.mkv",
        screenFilePath: "raw-footage/2026-10-13 11111111/screen.mkv",
        micFilePath: "raw-footage/2026-10-13 11111111/mic.mkv",
      });
      expect(
        await Effect.runPromise(
          resolveStoragePath(row!.micFilePath, [root], "Footage").pipe(
            Effect.provide(NodeContext.layer)
          )
        )
      ).toBe(files.mic);
    } finally {
      process.env.STORAGE_ROOTS = previous;
      nodeFs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hands the editor each saved Clip with its Recording Session, to play as the composite", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();
    await ingest.feed(
      started(video.id),
      sceneChanged(2, "Code", 0),
      sceneChanged(3, "Camera", 4),
      ...speech(4, 2, 6)
    );
    const saved = ingest.messages.find((m) => m.type === "clips-saved");
    if (saved?.type !== "clips-saved") throw new Error("no Clips saved");
    expect(saved.clips[0]!.recordingSession).toEqual({
      id: SESSION,
      cameraFilePath: FILES.camera,
      screenFilePath: FILES.screen,
      micFilePath: FILES.mic,
      micOffsetMs: 150,
      format: "landscape",
      screenCaptured: true,
      micEq: null,
      sceneEvents: [
        { fileTime: 0, scene: "Code" },
        { fileTime: 4, scene: "Camera" },
      ],
    });
  });

  it("enqueues a transcribe-clips Job that transcribes the new Clip from the mic file at mic time", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();
    await ingest.feed(started(video.id), ...speech(2, 2, 5));
    const saved = ingest.messages.find((m) => m.type === "clips-saved");
    if (saved?.type !== "clips-saved") throw new Error("no Clips saved");

    const job = await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* JobOperationsService;
        return yield* jobs.getJob(saved.transcriptionJobId);
      }).pipe(Effect.provide(layer()))
    );
    expect(job).toMatchObject({
      kind: "transcribe-clips",
      params: { clipIds: saved.clips.map((c) => c.id) },
    });

    const heard: { inputVideo: string; startTime: number }[] = [];
    const whisper = Layer.succeed(WhisperTranscriptionService, {
      transcribeClips: (
        clips: ReadonlyArray<{
          id: string;
          inputVideo: string;
          startTime: number;
        }>
      ) => {
        heard.push(...clips);
        return Effect.succeed(
          clips.map((c) => ({
            id: c.id,
            words: [{ start: 0, end: 1, text: "hello" }],
            segments: [{ start: 0, end: 1, text: "hello" }],
          }))
        );
      },
    } as unknown as WhisperTranscriptionService);
    await Effect.runPromise(
      transcribeAndStoreClips(saved.clips.map((c) => c.id)).pipe(
        Effect.provide(
          Layer.mergeAll(
            layer(),
            whisper,
            NodeContext.layer,
            SidecarContextTest,
            // Its Footage is under no Storage Root, so is read where it is.
            Layer.setConfigProvider(
              ConfigProvider.fromMap(
                new Map([["STORAGE_ROOTS", "/no-such-storage-root"]])
              )
            )
          )
        )
      )
    );

    // Speech heard at mic time 2.0 is cut at picture time 2.15; Whisper hears
    // the mic from 2.0, not 150 ms into the take.
    expect(heard).toMatchObject([{ inputVideo: MIC, startTime: 2 }]);
    expect(
      (await clipService.getTimeline(video.id)).map(
        (i) => i.type === "clip" && i.data.text
      )
    ).toEqual(["hello"]);
  });

  it("stores the frames lost when the Recording Session stops", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(started(video.id), {
      ...stopped(2),
      framesLost: { camera: 1, screen: 3 },
    });

    expect(await readSession()).toMatchObject({
      status: "stopped",
      cameraFramesLost: 1,
      screenFramesLost: 3,
    });
    expect(ingest.messages.at(-1)).toMatchObject({
      type: "recording-stopped",
      framesLost: { camera: 1, screen: 3 },
      crashed: false,
    });
  });

  it("marks a crashed Recording Session crashed and keeps the Clips heard before the crash", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(started(video.id), ...speech(2, 2, 5), {
      type: "speech-started",
      seq: 4,
      recordingSessionId: SESSION,
      fileTime: 8,
    });
    // The recorder service died; on its next start it repaired the files,
    // ended the take where the mic file ends, and logged the crash.
    await ingest.feed(
      {
        type: "speech-ended",
        seq: 5,
        recordingSessionId: SESSION,
        fileTime: 11,
      },
      {
        type: "recording-crashed",
        seq: 6,
        recordingSessionId: SESSION,
        files: FILES,
        repairs: { camera: "remuxed", screen: "remuxed", mic: "remuxed" },
      }
    );

    expect((await readSession())?.status).toBe("crashed");
    expect(
      (await savedClips(video.id)).map((c) => [
        c.sourceStartTime,
        c.sourceEndTime,
      ])
    ).toEqual([
      [2.15, 5.23],
      [8.15, 11.23],
    ]);
    expect(ingest.messages.at(-1)).toMatchObject({
      type: "recording-stopped",
      crashed: true,
      framesLost: null,
    });
  });

  it("tells the editor the camera was lost", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const ingest = recorderIngest();

    await ingest.feed(
      started(video.id),
      {
        type: "camera-lost",
        seq: 2,
        recordingSessionId: SESSION,
        fileTime: 10,
        errors: ["Error during demuxing: I/O error"],
      },
      { ...stopped(3), reason: "camera-lost" }
    );

    expect(ingest.messages.map((m) => m.type)).toEqual([
      "recording-started",
      "camera-lost",
      "recording-stopped",
    ]);
    expect((await readSession())?.status).toBe("stopped");
  });

  it("refuses a Recording Session on a Video outside the Draft, and says so", async () => {
    const { videoIds } = await seedCourseVersion(
      testDb,
      [{ path: "01-frozen", videos: [{ description: null, clips: [] }] }],
      { commitState: "published" }
    );
    const videoId = videoIds["01-frozen/Explainer"]!;
    const ingest = recorderIngest();

    await ingest.feed(started(videoId), ...speech(2, 2, 5));

    expect(await readSession()).toBeUndefined();
    expect(ingest.messages).toEqual([
      {
        type: "recorder-failed",
        message: expect.stringContaining("not the Draft"),
      },
    ]);
  });

  it("lets Record start only on a Draft Video that records with the CVM recorder", async () => {
    const canRecord = (videoId: string) =>
      Effect.runPromise(
        requireRecordableVideo(testDb as never, videoId).pipe(
          Effect.as("ok"),
          Effect.catchAll((e) => Effect.succeed(e._tag))
        )
      );
    const video = await clipService.createVideo("CVM recorder");
    expect(await canRecord(video.id)).toBe("RecordOnOBSVideoError");

    await testDb
      .update(videos)
      .set({ recorder: "cvm" })
      .where(eq(videos.id, video.id));
    expect(await canRecord(video.id)).toBe("ok");

    const { videoIds } = await seedCourseVersion(
      testDb,
      [{ path: "01-frozen", videos: [{ description: null, clips: [] }] }],
      { commitState: "published" }
    );
    const frozen = videoIds["01-frozen/Explainer"]!;
    await testDb
      .update(videos)
      .set({ recorder: "cvm" })
      .where(eq(videos.id, frozen));
    expect(await canRecord(frozen)).toBe("VersionNotDraftError");
  });
});
