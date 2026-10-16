import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";
import {
  clipRecorder,
  DEFAULT_MIC_OFFSET_MS,
} from "../features/videos/recorder.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const seedVideo = async () => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "standalone", originalFootagePath: "/footage/v1" })
    .returning();
  return video!;
};

describe("Recording Session schema", () => {
  it("stores a Recording Session with its scene events and a Clip cut from it", async () => {
    const video = await seedVideo();
    await testDb
      .update(schema.videos)
      .set({ recorder: "cvm" })
      .where(eq(schema.videos.id, video.id));

    const [session] = await testDb
      .insert(schema.recordingSessions)
      .values({
        videoId: video.id,
        cameraFilePath: "/mnt/d/footage/s1-camera.mkv",
        screenFilePath: "/mnt/d/footage/s1-screen.mkv",
        micFilePath: "/mnt/d/footage/s1-mic.mkv",
      })
      .returning();
    await testDb.insert(schema.recordingSessionSceneEvents).values([
      { recordingSessionId: session!.id, fileTime: 0, scene: "Camera" },
      { recordingSessionId: session!.id, fileTime: 12.5, scene: "Code" },
    ]);
    await testDb.insert(schema.clips).values({
      videoId: video.id,
      videoFilename: session!.micFilePath,
      sourceStartTime: 13,
      sourceEndTime: 20,
      order: "a0",
      text: "",
      scene: "Code",
      recordingSessionId: session!.id,
      sceneOverride: "Camera",
    });

    const readBack = await testDb.query.recordingSessions.findFirst({
      where: eq(schema.recordingSessions.id, session!.id),
      with: {
        video: true,
        sceneEvents: { orderBy: (e, { asc }) => [asc(e.fileTime)] },
        clips: true,
      },
    });

    expect(readBack!.clips.map(clipRecorder)).toEqual(["cvm"]);
    expect(readBack).toMatchObject({
      micOffsetMs: DEFAULT_MIC_OFFSET_MS,
      status: "recording",
      silenceLength: "short",
      cameraFramesLost: 0,
      screenFramesLost: 0,
      sceneEvents: [
        { fileTime: 0, scene: "Camera" },
        { fileTime: 12.5, scene: "Code" },
      ],
      clips: [
        {
          videoFilename: "/mnt/d/footage/s1-mic.mkv",
          scene: "Code",
          sceneOverride: "Camera",
        },
      ],
    });
  });

  it("reads an old OBS Clip as OBS, unlinked from any Recording Session", async () => {
    const video = await seedVideo();
    await testDb.insert(schema.clips).values({
      videoId: video.id,
      videoFilename: "/footage/obs.mkv",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "hello",
    });

    const readBack = await testDb.query.videos.findFirst({
      where: eq(schema.videos.id, video.id),
      with: { clips: true },
    });

    expect(readBack!.clips.map(clipRecorder)).toEqual(["obs"]);
    expect(readBack!.clips).toMatchObject([
      { recordingSessionId: null, sceneOverride: null },
    ]);
  });

  it("keeps a Recording Session, and a copy's Clip on it, when the Video it was filmed for is deleted", async () => {
    const video = await seedVideo();
    const [session] = await testDb
      .insert(schema.recordingSessions)
      .values({
        videoId: video.id,
        cameraFilePath: "c",
        screenFilePath: "s",
        micFilePath: "m",
      })
      .returning();
    await testDb.insert(schema.recordingSessionSceneEvents).values({
      recordingSessionId: session!.id,
      fileTime: 0,
      scene: "Camera",
    });
    await testDb.insert(schema.clips).values({
      videoId: video.id,
      videoFilename: "m",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a0",
      text: "",
      recordingSessionId: session!.id,
    });

    const copy = await seedVideo();
    await testDb.insert(schema.clips).values({
      videoId: copy.id,
      videoFilename: "m",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a0",
      text: "",
      recordingSessionId: session!.id,
    });

    await testDb.delete(schema.videos).where(eq(schema.videos.id, video.id));

    const readBack = await testDb.query.recordingSessions.findFirst({
      with: { sceneEvents: true, clips: true },
    });
    expect(readBack).toMatchObject({
      id: session!.id,
      videoId: null,
      sceneEvents: [{ scene: "Camera" }],
      clips: [{ videoId: copy.id }],
    });
  });
});
