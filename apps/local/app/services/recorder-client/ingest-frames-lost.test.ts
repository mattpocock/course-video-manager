import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { recordingSessions } from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { RecordingSessionEvent } from "recorder-service/protocol";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "../clip-service-test-setup";
import { ingestRecorderEvent } from "./ingest.server";
import { createRecorderEventSequencer } from "./sequencer";

/**
 * What the editor needs for the frames-lost alert (#2227), in picture time:
 * where each Take's Clip falls, and where frames were lost (PGlite).
 */

setupClipServiceTests();

const SESSION = "11111111-2222-3333-4444-555555555555";
const DIR = "/mnt/d/recordings/2026-10-15 11111111";
const FILES = {
  camera: `${DIR}/camera.mkv`,
  screen: `${DIR}/screen.mkv`,
  mic: `${DIR}/mic.mkv`,
};

/** Feeds events through the sequencer and ingest, as the recorder client does. */
const feed = async (events: RecordingSessionEvent[]) => {
  const sequencer = createRecorderEventSequencer();
  const messages: CvmRecorderMessage[] = [];
  for (const event of events) {
    for (const next of sequencer.accept(event).ready) {
      const result = await Effect.runPromise(
        ingestRecorderEvent(
          testDb as never,
          next,
          // As the recorder client asks: telling the editors first.
          async (_videoId, recordingSessionId, clip) => {
            messages.push({ type: "speech-ended", recordingSessionId, clip });
            return null;
          }
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              JobOperationsService.Default,
              ClipOperationsService.Default
            ).pipe(
              Layer.provide(Layer.succeed(DrizzleService, testDb as never))
            )
          )
        )
      );
      messages.push(...result.messages);
    }
  }
  return messages;
};

describe("recorder ingest, for the frames-lost alert", () => {
  it("tells the editor where each Take's Clip falls, and where frames were lost, in picture time", async () => {
    const video = await clipService.createVideo("CVM recorder");
    const lostFrameSpans = [
      { picture: "screen" as const, from: 0.1, to: 0.9, frames: 54 },
    ];
    const framesLost = { camera: 0, screen: 54 };

    const messages = await feed([
      {
        type: "recording-started",
        seq: 1,
        recordingSessionId: SESSION,
        videoId: video.id,
        t0Ms: 1_760_000_000_000,
        silenceLength: "short",
        files: FILES,
      },
      {
        type: "speech-started",
        seq: 2,
        recordingSessionId: SESSION,
        fileTime: 2,
      },
      {
        type: "take-started",
        seq: 3,
        recordingSessionId: SESSION,
        fileTime: 4.8,
      },
      {
        type: "frames-lost",
        seq: 4,
        recordingSessionId: SESSION,
        fileTime: 4.9,
        ...framesLost,
        lostFrameSpans,
      },
      {
        type: "speech-ended",
        seq: 5,
        recordingSessionId: SESSION,
        fileTime: 5,
      },
      {
        type: "recording-stopped",
        seq: 6,
        recordingSessionId: SESSION,
        reason: "requested",
        fileTime: 30,
        files: FILES,
        exitCodes: { screen: 0, camera: 0 },
        framesLost,
        lostFrameSpans,
        errors: [],
      },
    ]);

    // Its speech's start, moved by the 150 ms mic offset.
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "take-started", startTime: 2.15 })
    );
    // The bounds its Clip is cut to: frame-snapped, end padded.
    expect(messages).toContainEqual({
      type: "speech-ended",
      recordingSessionId: SESSION,
      clip: { startTime: 2.15, endTime: 5.23 },
    });
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "frames-lost", lostFrameSpans })
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "recording-stopped", lostFrameSpans })
    );
    // Every lost frame is still stored, in or out of a Clip.
    const session = await testDb.query.recordingSessions.findFirst({
      where: eq(recordingSessions.id, SESSION),
    });
    expect(session?.screenFramesLost).toBe(54);
  });
});
