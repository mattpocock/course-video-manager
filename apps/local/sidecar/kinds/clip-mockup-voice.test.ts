import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Exit, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { STORAGE_ROOTS_ENV_KEY } from "@/services/storage-roots";
import {
  ClipMockupSpeechService,
  pcmToWav,
  SpeechSynthesisError,
} from "@/services/clip-mockup-speech-service";
import * as schema from "@cvm/core/db/schema";
import { eq } from "drizzle-orm";
import type { JobContext } from "../job-kind";
import { CLIP_MOCKUP_VOICE_POLICY } from "../retry-policy";
import { clipMockupVoiceJobKind } from "./clip-mockup-voice";
import { idleGpuGate } from "@/test-utils/idle-gpu-gate";

// ===========================================================================
// The `clip-mockup-voice` Job: what `cvm clip-mockup add` no longer waits
// for. Kokoro is faked through the same seam the CLI suites use
// (`ClipMockupSpeechService`), so no daemon starts and no model loads.
// ===========================================================================

const FAKE_DURATION_SECONDS = 1.5;
const SPEECH_FAILURE_MESSAGE = "Kokoro could not load onto the GPU";

interface SpeechFake {
  readonly layer: Layer.Layer<ClipMockupSpeechService>;
  /** Every line handed to the synthesiser, in order. */
  readonly spoken: string[];
}

/** Voices anything, instantly, as FAKE_DURATION_SECONDS of silence. */
const fakeSpeech = (): SpeechFake => {
  const spoken: string[] = [];
  const wav = pcmToWav(Buffer.alloc(24000 * 2 * FAKE_DURATION_SECONDS), 24000);
  const layer = Layer.succeed(ClipMockupSpeechService, {
    synthesizeLine: (line: string) =>
      Effect.sync(() => {
        spoken.push(line);
        return { wav, durationSeconds: FAKE_DURATION_SECONDS };
      }),
  } as unknown as ClipMockupSpeechService);
  return { layer, spoken };
};

/** Refuses every line. */
const failingSpeech = (): SpeechFake => {
  const spoken: string[] = [];
  const layer = Layer.succeed(ClipMockupSpeechService, {
    synthesizeLine: (line: string) =>
      Effect.suspend(() => {
        spoken.push(line);
        return Effect.fail(
          new SpeechSynthesisError({
            cause: null,
            message: SPEECH_FAILURE_MESSAGE,
          })
        );
      }),
  } as unknown as ClipMockupSpeechService);
  return { layer, spoken };
};

let testDb: TestDb;
let dbLayer: Layer.Layer<
  ClipMockupOperationsService | ClipMockupVoiceOperationsService
>;
let store: string;
const originalStore = process.env[STORAGE_ROOTS_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  dbLayer = Layer.mergeAll(
    ClipMockupOperationsService.Default,
    ClipMockupVoiceOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  store = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-voice-job-"));
  process.env[STORAGE_ROOTS_ENV_KEY] = store;
  await testDb.insert(schema.videos).values({
    id: "video-1",
    lineageId: "lineage-1",
    title: "video-1.mp4",
    originalFootagePath: "/footage/video-1",
  });
});

afterAll(() => {
  if (originalStore === undefined) delete process.env[STORAGE_ROOTS_ENV_KEY];
  else process.env[STORAGE_ROOTS_ENV_KEY] = originalStore;
});

/** Clip Mockups as `cvm clip-mockup add` leaves them: voice pending. */
const addPending = (...lines: string[]) =>
  Effect.runPromise(
    Effect.flatMap(ClipMockupOperationsService, (ops) =>
      ops.createClipMockups(
        "video-1",
        lines.map((line, i) => ({
          type: "clipMockup" as const,
          line,
          imagePath: `${i}.png`,
        }))
      )
    ).pipe(
      Effect.map((rows) => rows.map((r) => r.id)),
      Effect.provide(dbLayer)
    )
  );

const readRow = (id: string) =>
  testDb.query.clipMockups.findFirst({
    where: eq(schema.clipMockups.id, id),
  });

const ctxAt = (attempt: number): JobContext => ({
  jobId: "job-1",
  attempt,
  maxAttempts: CLIP_MOCKUP_VOICE_POLICY.maxAttempts,
  enqueue: () => Effect.die("this kind starts no other Job"),
  emit: () => Effect.void,
});

const runJob = (ids: string[], speech: SpeechFake, attempt = 1) =>
  Effect.runPromise(
    Effect.exit(
      clipMockupVoiceJobKind.runRaw(
        { clipMockupIds: ids, lines: {} },
        ctxAt(attempt)
      )
    ).pipe(
      Effect.provide(
        Layer.mergeAll(dbLayer, speech.layer, NodeContext.layer, idleGpuGate)
      )
    ) as Effect.Effect<Exit.Exit<void, unknown>>
  );

describe("the clip-mockup-voice Job kind", () => {
  it("retries a few times, and is not a post", () => {
    expect(clipMockupVoiceJobKind.maxAttempts).toBe(3);
    expect("posting" in clipMockupVoiceJobKind).toBe(false);
    expect(clipMockupVoiceJobKind.lane).toBe("default");
  });

  it("voices each pending line, writes its WAV, and marks it ready", async () => {
    const ids = await addPending("Here's the problem.", "And the fix.");
    const speech = fakeSpeech();

    const exit = await runJob(ids, speech);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(speech.spoken).toEqual(["Here's the problem.", "And the fix."]);
    for (const id of ids) {
      const row = (await readRow(id))!;
      expect(row.voiceStatus).toBe("ready");
      expect(row.durationSeconds).toBe(FAKE_DURATION_SECONDS);
      expect(
        nodeFs.existsSync(
          nodePath.join(store, "clip-mockups", "lineage-1", row.audioPath!)
        )
      ).toBe(true);
    }
  });

  it("voices the same words once, and both rows share the WAV", async () => {
    const ids = await addPending("Hold that thought.", "Hold that thought.");
    const speech = fakeSpeech();

    await runJob(ids, speech);

    expect(speech.spoken).toEqual(["Hold that thought."]);
    const [a, b] = await Promise.all(ids.map(readRow));
    expect(a!.audioPath).toBe(b!.audioPath);
    expect(
      nodeFs.readdirSync(nodePath.join(store, "clip-mockups", "lineage-1"))
    ).toEqual([a!.audioPath]);
  });

  it("voices nothing already ready: a re-run repeats no work", async () => {
    const ids = await addPending("Once only.");
    await runJob(ids, fakeSpeech());
    const again = fakeSpeech();

    const exit = await runJob(ids, again);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(again.spoken).toEqual([]);
  });

  it("leaves a Clip Mockup deleted while it is voiced unvoiced, and keeps no WAV for it", async () => {
    const [id] = await addPending("Deleted mid-Job.");
    const speech = fakeSpeech();
    // The author deletes it (archives it) while Kokoro is voicing its line.
    const deleting: SpeechFake = {
      spoken: speech.spoken,
      layer: Layer.succeed(ClipMockupSpeechService, {
        synthesizeLine: (line: string) =>
          Effect.promise(() =>
            testDb
              .update(schema.clipMockups)
              .set({ archived: true })
              .where(eq(schema.clipMockups.id, id!))
          ).pipe(
            Effect.zipRight(
              Effect.flatMap(ClipMockupSpeechService, (s) =>
                s.synthesizeLine(line)
              ).pipe(Effect.provide(speech.layer))
            )
          ),
      } as unknown as ClipMockupSpeechService),
    };

    const exit = await runJob([id!], deleting);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await readRow(id!)).toMatchObject({
      archived: true,
      voiceStatus: "pending",
      audioPath: null,
    });
    const dir = nodePath.join(store, "clip-mockups", "lineage-1");
    expect(
      nodeFs.existsSync(dir)
        ? nodeFs.readdirSync(dir).filter((f) => f.endsWith(".wav"))
        : []
    ).toEqual([]);
  });

  // Marking it failed once no attempt is left is the Sidecar's terminal
  // path (`afterFinalFailure`): clip-mockup-voice-final-failure.test.ts.
  it("leaves the voice pending when an attempt fails", async () => {
    const ids = await addPending("Will fail.");

    const exit = await runJob(ids, failingSpeech(), 1);

    expect(Exit.isFailure(exit)).toBe(true);
    expect((await readRow(ids[0]!))!.voiceStatus).toBe("pending");
  });
});
