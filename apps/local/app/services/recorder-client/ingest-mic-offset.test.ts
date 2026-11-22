import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { avCalibrations, recordingSessions } from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { RecordingSessionEvent } from "recorder-service/protocol";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { ingestRecorderEvent } from "./ingest.server";
import { createRecorderEventSequencer } from "./sequencer";
import { nowMs, toDate } from "@/packages/clock";

/**
 * A new Recording Session starts with the Mic Offset of its camera + mic
 * pair: the latest passed AV Calibration's on that pair (PGlite). An
 * unmeasured pair, or a service from before protocol 10, gets 150 ms.
 */

setupClipServiceTests();

const CAMERA = "Cam Link 4K";
const MIC = "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)";
const DIR = "/mnt/d/recordings/2026-10-12 11111111";

/** One `recording-started`, through the sequencer as the client feeds it. */
const ingest = (event: RecordingSessionEvent) =>
  Effect.runPromise(
    ingestRecorderEvent(
      testDb as never,
      createRecorderEventSequencer().accept(event).ready[0]!,
      async () => null
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          JobOperationsService.Default,
          ClipOperationsService.Default
        ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)))
      )
    )
  );

const started = (
  id: string,
  videoId: string,
  devices?: { camera: string; mic: string }
): RecordingSessionEvent => ({
  type: "recording-started",
  seq: 1,
  recordingSessionId: id,
  videoId,
  t0Ms: 1_760_000_000_000,
  silenceLength: "short",
  files: {
    camera: `${DIR}/camera.mkv`,
    screen: `${DIR}/screen.mkv`,
    mic: `${DIR}/mic.mkv`,
  },
  devices,
});

/** A passing AV Calibration on a pair, `minutesAgo` before now. */
const calibrated = (
  id: string,
  o: {
    micOffsetMs: number;
    minutesAgo: number;
    camera?: string;
    mic?: string;
    outcome?: "passed" | "failed";
  }
) =>
  testDb.insert(avCalibrations).values({
    id,
    createdAt: toDate(nowMs() - o.minutesAgo * 60_000),
    outcome: o.outcome ?? "passed",
    noiseFloorDb: -80,
    speechLufs: -27,
    truePeakDb: -10,
    thresholdDb: -43,
    recorderMic: o.mic ?? MIC,
    scriptVersion: 4,
    micFilePath: `/calibrations/${id}/mic.wav`,
    scriptFilePath: `/calibrations/${id}/calibration-script.json`,
    cameraDevice: o.camera ?? CAMERA,
    clapsFound: 5,
    clapSpreadMs: 8,
    micOffsetMs: o.micOffsetMs,
    cameraFilePath: `/calibrations/${id}/camera.mkv`,
  });

const micOffsetOf = async (id: string) =>
  (
    await testDb.query.recordingSessions.findFirst({
      where: eq(recordingSessions.id, id),
      columns: { micOffsetMs: true },
    })
  )?.micOffsetMs;

const S1 = "11111111-0000-0000-0000-000000000001";
const S2 = "11111111-0000-0000-0000-000000000002";
const S3 = "11111111-0000-0000-0000-000000000003";
const S4 = "11111111-0000-0000-0000-000000000004";

describe("a new Recording Session's mic offset", () => {
  it("is its pair's latest passed Mic Offset, rounded; 150 for another camera or mic, or none named", async () => {
    const video = await clipService.createVideo("CVM recorder");
    await calibrated("older", { micOffsetMs: 120, minutesAgo: 60 });
    await calibrated("latest", { micOffsetMs: 161.6, minutesAgo: 30 });
    await calibrated("failed-since", {
      micOffsetMs: 300,
      minutesAgo: 10,
      outcome: "failed",
    });
    await calibrated("other-camera", {
      micOffsetMs: 90,
      minutesAgo: 5,
      camera: "Another Camera",
    });

    await ingest(started(S1, video.id, { camera: CAMERA, mic: MIC }));
    await ingest(started(S2, video.id, { camera: CAMERA, mic: "USB Mic" }));
    await ingest(started(S3, video.id, { camera: "Webcam", mic: MIC }));
    await ingest(started(S4, video.id));

    expect(await micOffsetOf(S1)).toBe(162);
    expect(await micOffsetOf(S2)).toBe(150);
    expect(await micOffsetOf(S3)).toBe(150);
    expect(await micOffsetOf(S4)).toBe(150);
  });

  it("is never changed by a later AV Calibration", async () => {
    const video = await clipService.createVideo("CVM recorder");
    await calibrated("first", { micOffsetMs: 140, minutesAgo: 60 });
    await ingest(started(S1, video.id, { camera: CAMERA, mic: MIC }));

    await calibrated("second", { micOffsetMs: 180, minutesAgo: 1 });
    // Replayed after a restart: the row it already made stays as it was.
    await ingest(started(S1, video.id, { camera: CAMERA, mic: MIC }));
    await ingest(started(S2, video.id, { camera: CAMERA, mic: MIC }));

    expect(await micOffsetOf(S1)).toBe(140);
    expect(await micOffsetOf(S2)).toBe(180);
  });
});
