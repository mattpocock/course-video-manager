import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger } from "effect";
import { NodeContext } from "@effect/platform-node";
import { eq } from "drizzle-orm";
import * as schema from "@cvm/core/db/schema";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { STORAGE_ROOTS_ENV_KEY } from "@/services/storage-roots";
import {
  ClipMockupSpeechService,
  SpeechSynthesisError,
} from "@/services/clip-mockup-speech-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { enqueueJob } from "../job-kinds";
import { makeJsonLogger } from "../json-logger";
import { runSidecar, type SidecarTiming } from "../sidecar";
import { clipMockupVoiceJobKind } from "./clip-mockup-voice";

// ===========================================================================
// A `clip-mockup-voice` Job that ends for good, BY ANY ROUTE — its last
// attempt threw, or its last run was lost (the Sidecar killed, the lease
// expired) — leaves no Clip Mockup `pending`. Run through a real Sidecar, so
// the Sidecar's own terminal path is what marks the rows.
// ===========================================================================

const SPEECH_FAILURE_MESSAGE = "Kokoro could not load onto the GPU";
const registry = { "clip-mockup-voice": clipMockupVoiceJobKind } as const;

const TIMING: SidecarTiming = {
  leaseMs: 2_000,
  leaseRenewMs: 500,
  jobLeaseMs: 2_000,
  jobHeartbeatMs: 500,
  pollMs: 50,
  recoverEveryMs: 1_000,
  lapseWaitMs: 200,
  postCheckTimeoutMs: 1_000,
};

let testDb: TestDb;
let dir: string;
const originalStore = process.env[STORAGE_ROOTS_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-voice-final-"));
  process.env[STORAGE_ROOTS_ENV_KEY] = dir;
  await testDb.insert(schema.videos).values({
    id: "video-1",
    lineageId: "lineage-1",
    title: "video-1.mp4",
    originalFootagePath: "/footage/video-1",
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  if (originalStore === undefined) delete process.env[STORAGE_ROOTS_ENV_KEY];
  else process.env[STORAGE_ROOTS_ENV_KEY] = originalStore;
});

const layer = () => {
  const db = Layer.succeed(DrizzleService, testDb as never);
  return Layer.mergeAll(
    JobOperationsService.Default,
    ClipMockupVoiceOperationsService.Default
  ).pipe(
    Layer.provide(db),
    Layer.merge(
      Layer.succeed(ClipMockupSpeechService, {
        synthesizeLine: () =>
          Effect.fail(
            new SpeechSynthesisError({
              cause: null,
              message: SPEECH_FAILURE_MESSAGE,
            })
          ),
      } as unknown as ClipMockupSpeechService)
    ),
    Layer.merge(NodeContext.layer),
    Layer.merge(
      Logger.replace(
        Logger.defaultLogger,
        makeJsonLogger({ logDir: dir, write: () => {} })
      )
    )
  );
};

/**
 * A pending Clip Mockup, and a voice Job for it on its LAST attempt. The row
 * is inserted directly: `createClipMockups` would queue a fresh Job for it,
 * and that one would cover this one.
 */
const pendingOnLastAttempt = (line: string) =>
  Effect.gen(function* () {
    const [row] = yield* Effect.promise(() =>
      testDb
        .insert(schema.clipMockups)
        .values({
          videoId: "video-1",
          line,
          imagePath: "0.png",
          voiceStatus: "pending",
          order: `a${line.length}`,
        })
        .returning()
    );
    const job = yield* enqueueJob({
      id: null,
      kind: "clip-mockup-voice",
      title: line,
      params: { clipMockupIds: [row!.id], lines: { [row!.id]: line } },
      dependsOn: null,
      subject: { type: "video", id: "video-1" },
      attemptsSpent: clipMockupVoiceJobKind.maxAttempts - 1,
      registry,
    });
    return { rowId: row!.id, jobId: job.id };
  });

const waitForJob = (id: string) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    for (let i = 0; i < 200; i++) {
      const job = yield* ops.getJob(id);
      if (job && !["queued", "running"].includes(job.status)) return job;
      yield* Effect.sleep(25);
    }
    return yield* Effect.dieMessage(`job ${id} never finished`);
  });

const voiceOf = (id: string) =>
  Effect.promise(() =>
    testDb.query.clipMockups.findFirst({
      where: eq(schema.clipMockups.id, id),
    })
  ).pipe(
    Effect.map((row) => ({
      voiceStatus: row!.voiceStatus,
      voiceError: row!.voiceError,
    }))
  );

describe("a clip-mockup-voice Job that fails for good", () => {
  it.live(
    "leaves no Clip Mockup pending, whether its last attempt threw or was lost",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;

        // Lost: a Sidecar took the last attempt and died (kill -9) — its
        // lease runs out and the next Sidecar's recovery settles it.
        const lost = yield* pendingOnLastAttempt("Lost on its last run.");
        yield* ops.claimNextJob({
          lane: clipMockupVoiceJobKind.lane,
          holder: "killed",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);

        const stop = yield* Deferred.make<string>();
        const serving = yield* Deferred.make<void>();
        const fiber = yield* Effect.fork(
          runSidecar({
            identity: {
              holder: "live",
              pid: process.pid,
              hostname: "test",
              checkout: "/checkouts/live",
              gitSha: "abc1234",
              socket: path.join(dir, "live.sock"),
            },
            registry,
            timing: TIMING,
            stop,
            serve: () => Deferred.succeed(serving, undefined),
          })
        );
        yield* Deferred.await(serving);

        // Thrown: the last attempt's voicing fails.
        const thrown = yield* pendingOnLastAttempt("Thrown on its last run.");

        expect((yield* waitForJob(lost.jobId)).status).toBe("interrupted");
        expect((yield* waitForJob(thrown.jobId)).status).toBe("failed");
        yield* Effect.sleep(100);

        expect(yield* voiceOf(lost.rowId)).toMatchObject({
          voiceStatus: "failed",
          voiceError: expect.stringContaining("stopped before it finished"),
        });
        expect(yield* voiceOf(thrown.rowId)).toEqual({
          voiceStatus: "failed",
          voiceError: SPEECH_FAILURE_MESSAGE,
        });

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer())) as Effect.Effect<void>
  );
});
