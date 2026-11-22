import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { estimateSpokenSeconds } from "@cvm/core/features/clip-mockups/estimate-spoken-seconds";
import { CLIP_MOCKUP_VOICING_EVENT } from "@cvm/core/features/clip-mockups/voice-status";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  makeTempClipMockupDir,
  ndjson,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import {
  addArgv,
  failingSpeech,
  makeClipMockupRun,
  updateArgv,
  voiceJobs,
} from "./cli-clip-mockup-test-harness";
import { now } from "@/packages/clock";
import { readEnv } from "@/packages/env";

// ===========================================================================
// cvm clip-mockup: the voice is QUEUED, never waited for
//
// `add` and `update` used to voice every line with Kokoro before they
// returned. Now they write the row with its voice `pending` and queue one
// `clip-mockup-voice` Job, which the Sidecar runs
// (sidecar/kinds/clip-mockup-voice.test.ts proves what it does). What this
// suite proves is the command's half: nothing is voiced in the `cvm`
// process — the speech fake here REFUSES every line, and every write still
// succeeds — the Job is queued with the right Clip Mockups, and the output
// still carries a run time an agent can sum, marked as a guess.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let sourceDir: string;
/** Refuses every line: a command that tried to voice one would fail. */
const speech = failingSpeech();
const originalLocalMachine = readEnv(LOCAL_MACHINE_ENV_KEY);

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeClipMockupRun(testDb, speech);
  frames = makeTempClipMockupDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-voice-src-"));
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  frames.cleanup();
  nodeFs.rmSync(sourceDir, { recursive: true, force: true });
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  nodeFs.rmSync(frames.dir, { recursive: true, force: true });
  nodeFs.mkdirSync(frames.dir, { recursive: true });
  speech.spoken.length = 0;
});

describe("cvm clip-mockup: voice", () => {
  interface Mockup {
    id: string;
    line: string;
    imagePath: string;
    audioPath: string | null;
    audioFile: string | null;
    durationSeconds: number;
    durationEstimated: boolean;
    voiceStatus: string;
    voiceError: string | null;
  }

  let frameCounter = 0;
  const sourceImage = (): string => {
    const full = nodePath.join(sourceDir, `frame-${frameCounter++}.png`);
    nodeFs.writeFileSync(full, "PNG-BYTES");
    return full;
  };

  const rows = (r: RunResult) => ndjson(r.stdout) as Mockup[];

  const add = async (...lines: string[]): Promise<Mockup[]> => {
    const r = await run(
      addArgv(
        s.standaloneActiveId,
        lines.map((say) => ({ say, image: sourceImage() }))
      )
    );
    expect(r.exitCode).toBe(0);
    return rows(r);
  };

  const update = async (entries: unknown[]): Promise<Mockup[]> => {
    const r = await run(updateArgv(entries));
    expect(r.exitCode).toBe(0);
    return rows(r);
  };

  const list = async (): Promise<Mockup[]> =>
    rows(await run(["clip-mockup", "list", "--video", s.standaloneActiveId]));

  /** The Sidecar finishing every voice Job queued so far. */
  const finishVoiceJobs = (status: "succeeded" | "failed") =>
    testDb
      .update(schema.jobs)
      .set({ status, finishedAt: now() })
      .where(eq(schema.jobs.kind, "clip-mockup-voice"));

  /** What the Sidecar's Job leaves on a row once the voice is made. */
  const voiceReady = async (id: string, durationSeconds: number) => {
    await testDb
      .update(schema.clipMockups)
      .set({
        voiceStatus: "ready",
        audioPath: "speech-x.wav",
        durationSeconds,
      })
      .where(eq(schema.clipMockups.id, id));
    await finishVoiceJobs("succeeded");
  };

  const voiceFailed = async (id: string) => {
    await testDb
      .update(schema.clipMockups)
      .set({ voiceStatus: "failed", voiceError: "the GPU would not load" })
      .where(eq(schema.clipMockups.id, id));
    await finishVoiceJobs("failed");
  };

  // -----------------------------------------------------------------------
  // add
  // -----------------------------------------------------------------------

  it("add voices nothing itself: the row is pending, with an estimated run time", async () => {
    const [row] = await add("Here's the problem.");

    // The fake refuses every line, so a voiced line would have failed `add`.
    expect(speech.spoken).toEqual([]);
    expect(row).toMatchObject({
      voiceStatus: "pending",
      voiceError: null,
      audioPath: null,
      audioFile: null,
      durationSeconds: estimateSpokenSeconds("Here's the problem."),
      durationEstimated: true,
    });
    // No WAV yet: the Sidecar writes it.
    const dir = nodePath.join(frames.dir, s.standaloneActiveLineageId);
    expect(nodeFs.readdirSync(dir).filter((f) => f.endsWith(".wav"))).toEqual(
      []
    );
  });

  it("add queues ONE voice Job for every Clip Mockup of the batch, and no Chapter", async () => {
    const r = await run(
      addArgv(s.standaloneActiveId, [
        { say: "One.", image: sourceImage() },
        { chapter: "The fix" },
        { say: "Two.", image: sourceImage() },
      ])
    );
    expect(r.exitCode).toBe(0);
    const ids = (ndjson(r.stdout) as { type: string; id: string }[])
      .filter((row) => row.type === "clipMockup")
      .map((row) => row.id);

    expect(await voiceJobs(testDb)).toEqual([
      { title: "Voice 2 Clip Mockups", maxAttempts: 3, clipMockupIds: ids },
    ]);
  });

  it("add's run times still sum into a Video's run time", async () => {
    await add("One two three.", "Four five six seven eight.");

    const total = (await list()).reduce(
      (sum, row) => sum + row.durationSeconds,
      0
    );
    expect(total).toBeCloseTo(
      estimateSpokenSeconds("One two three.") +
        estimateSpokenSeconds("Four five six seven eight."),
      5
    );
  });

  it("once the voice is ready, the run time is the measured one", async () => {
    const [created] = await add("Measured soon.");
    await voiceReady(created!.id, 2.125);

    const [row] = await list();

    expect(row).toMatchObject({
      voiceStatus: "ready",
      durationSeconds: 2.125,
      durationEstimated: false,
    });
    expect(row!.audioFile).toBe(
      nodePath.join(frames.dir, s.standaloneActiveLineageId, "speech-x.wav")
    );
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  it("update with a new line drops the old voice and queues the new one", async () => {
    const [created] = await add("Too dense by half.");
    await voiceReady(created!.id, 4);

    const [row] = await update([{ id: created!.id, say: "Shorter." }]);

    expect(speech.spoken).toEqual([]);
    expect(row).toMatchObject({
      line: "Shorter.",
      voiceStatus: "pending",
      audioPath: null,
      durationSeconds: estimateSpokenSeconds("Shorter."),
      durationEstimated: true,
      imagePath: created!.imagePath,
    });
    const jobs = await voiceJobs(testDb);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({
      title: "Voice 1 Clip Mockup",
      clipMockupIds: [created!.id],
    });
  });

  it("update with only an image leaves a ready voice alone and queues nothing", async () => {
    const [created] = await add("The line stays.");
    await voiceReady(created!.id, 3);

    const [row] = await update([{ id: created!.id, image: sourceImage() }]);

    expect(row).toMatchObject({
      voiceStatus: "ready",
      audioPath: "speech-x.wav",
      durationSeconds: 3,
    });
    expect(await voiceJobs(testDb)).toHaveLength(1);
  });

  it("update with only an image on a voice being made queues no second Job", async () => {
    const [created] = await add("Being voiced right now.");
    // The Sidecar has started the Job, and is voicing this very line.
    const [job] = await testDb.query.jobs.findMany({
      where: (t, { eq }) => eq(t.kind, "clip-mockup-voice"),
    });
    await testDb
      .update(schema.jobs)
      .set({ status: "running", holder: "sidecar" })
      .where(eq(schema.jobs.id, job!.id));
    await testDb.insert(schema.jobEvents).values({
      jobId: job!.id,
      type: CLIP_MOCKUP_VOICING_EVENT,
      data: { lines: { [created!.id]: "Being voiced right now." } },
    });

    const [row] = await update([{ id: created!.id, image: sourceImage() }]);

    expect(row).toMatchObject({ voiceStatus: "pending" });
    expect(await voiceJobs(testDb)).toHaveLength(1);
  });

  it("update on a FAILED voice re-queues it, whatever else the entry changes", async () => {
    const [created] = await add("This one failed.");
    await voiceFailed(created!.id);

    const [row] = await update([{ id: created!.id, image: sourceImage() }]);

    expect(row).toMatchObject({
      line: "This one failed.",
      voiceStatus: "pending",
      voiceError: null,
    });
    const jobs = await voiceJobs(testDb);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]!.clipMockupIds).toEqual([created!.id]);
  });

  it("a failed voice shows its reason, and an estimated run time", async () => {
    const [created] = await add("Never voiced.");
    await voiceFailed(created!.id);

    const [row] = await list();

    expect(row).toMatchObject({
      voiceStatus: "failed",
      voiceError: "the GPU would not load",
      durationSeconds: estimateSpokenSeconds("Never voiced."),
      durationEstimated: true,
    });
  });
});
