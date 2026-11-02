import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { clipRecordingSessionRelation } from "@cvm/core/services/clip-recording-session-relation";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { clipComposite, clipSource } from "@/packages/clip-source";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "./clip-service-test-setup";

setupClipServiceTests();

/** Two CVM-recorder Clips cut from one Recording Session, 10–20 s and 25–30 s. */
const seedCvmRecorderVideo = async () => {
  const video = await clipService.createVideo("mic");
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video.id,
      cameraFilePath: "/rec/camera.mkv",
      screenFilePath: "/rec/screen.mkv",
      micFilePath: "/rec/mic.mkv",
    })
    .returning();
  const [first, second] = await testDb
    .insert(schema.clips)
    .values(
      [
        [10, 20, "a0"],
        [25, 30, "a1"],
      ].map(([start, end, order]) => ({
        videoId: video.id,
        videoFilename: session!.micFilePath,
        sourceStartTime: start as number,
        sourceEndTime: end as number,
        order: order as string,
        text: "",
        scene: "Code",
        recordingSessionId: session!.id,
      }))
    )
    .returning();
  return { video, first: first!, second: second! };
};

const seedObsVideo = async () => {
  const video = await clipService.createVideo("obs");
  await clipService.appendClips({
    videoId: video.id,
    insertionPoint: { type: "start" },
    items: [],
    clips: [{ inputVideo: "/obs/take.mkv", startTime: 0, endTime: 5 }],
  });
  return video;
};

/** The Video's Clips as every export reader loads them. */
const readClips = (videoId: string) =>
  testDb.query.clips.findMany({
    where: eq(schema.clips.videoId, videoId),
    orderBy: (c, { asc }) => asc(c.order),
    with: { recordingSession: clipRecordingSessionRelation, layers: true },
  });

const exportHashOf = async (videoId: string) =>
  computeExportHash(
    toExportClips(
      (await readClips(videoId)).map((c) => ({ ...c, overlays: [] }))
    ),
    "landscape",
    []
  );

describe("mic offset", () => {
  it("sets the Recording Session's offset without moving its Clips, and the Video needs a new export", async () => {
    const { video, first } = await seedCvmRecorderVideo();
    const before = await exportHashOf(video.id);

    await clipService.updateMicOffset(first.id, 210);

    const clips = await readClips(video.id);
    expect(
      clips.map((c) => [
        c.recordingSession?.micOffsetMs,
        c.sourceStartTime,
        c.sourceEndTime,
      ])
    ).toEqual([
      [210, 10, 20],
      [210, 25, 30],
    ]);
    expect(await exportHashOf(video.id)).not.toBe(before);
  });

  it("refuses an offset on an OBS Clip, which has no separate mic", async () => {
    const video = await seedObsVideo();
    const [clip] = await readClips(video.id);
    await expect(clipService.updateMicOffset(clip!.id, 210)).rejects.toThrow(
      /OBS Clip/
    );
  });
});

describe("mic EQ", () => {
  it("exports every CVM-recorder Video with the saved EQ, so each needs a new export, and leaves OBS Videos alone", async () => {
    const a = await seedCvmRecorderVideo();
    const b = await seedCvmRecorderVideo();
    const obs = await seedObsVideo();
    const before = await Promise.all(
      [a.video, b.video, obs].map((v) => exportHashOf(v.id))
    );

    const quieterHighs = { lowDb: 1, midDb: 0, highDb: -3 };
    await clipService.updateMicEq(quieterHighs);

    const after = await Promise.all(
      [a.video, b.video, obs].map((v) => exportHashOf(v.id))
    );
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    const [clip] = await readClips(a.video.id);
    expect(clipComposite(clipSource(clip!))?.eq).toEqual(quieterHighs);
  });
});
