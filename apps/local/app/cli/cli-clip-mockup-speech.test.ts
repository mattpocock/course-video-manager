import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  CLIP_MOCKUP_TTS_MODEL,
  CLIP_MOCKUP_VOICE,
  speechFilename,
} from "@/services/clip-mockup-speech-service";
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
  fakeSpeech,
  makeClipMockupRun,
  updateArgv,
  FAKE_DURATION_SECONDS,
  SPEECH_FAILURE_MESSAGE,
} from "./cli-clip-mockup-test-harness";

// ===========================================================================
// cvm clip-mockup: the line is spoken and timed
//
// The third clip-mockup suite (the noun's own file was split once already for
// the repo's per-file token budget). What it is here to prove: a Clip Mockup
// knows how long it RUNS the moment it is added, so an authoring agent can
// say a Lesson is 34 minutes before anybody presses play.
//
// The speech service is replaced wholesale by Layer.succeed, exactly as the
// `cvm footage` suite replaces VideoProcessingService: NO MODEL IS EVER
// LOADED HERE, and `speech.spoken` is the record of what the command actually
// asked to have voiced — which is how the WAV cache is asserted.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let runFailing: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let frames: ReturnType<typeof makeTempClipMockupDir>;
let sourceDir: string;
const speech = fakeSpeech();
const broken = failingSpeech();
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  run = makeClipMockupRun(testDb, speech);
  runFailing = makeClipMockupRun(testDb, broken);
  frames = makeTempClipMockupDir();
  sourceDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-speech-src-"));
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
  broken.spoken.length = 0;
});

describe("cvm clip-mockup: speech", () => {
  interface Mockup {
    id: string;
    videoId: string;
    line: string;
    imagePath: string;
    audioPath: string | null;
    durationSeconds: number | null;
    order: string;
    archived: boolean;
  }

  /** The first row a batch printed. */
  const first = (stdout: string): Mockup => (ndjson(stdout) as Mockup[])[0]!;

  let frameCounter = 0;
  const sourceImage = (): string => {
    const full = nodePath.join(sourceDir, `frame-${frameCounter++}.png`);
    nodeFs.writeFileSync(full, "PNG-BYTES");
    return full;
  };

  const add = async (videoId: string, line: string): Promise<Mockup> =>
    first(
      (await run(addArgv(videoId, [{ say: line, image: sourceImage() }])))
        .stdout
    );

  const updateLine = async (id: string, line: string): Promise<Mockup> =>
    first((await run(updateArgv([{ id, say: line }]))).stdout);

  const list = async (videoId: string): Promise<Mockup[]> =>
    ndjson(
      (await run(["clip-mockup", "list", "--video", videoId])).stdout
    ) as Mockup[];

  const dirFor = (lineageId: string) => nodePath.join(frames.dir, lineageId);
  const wavsIn = (lineageId: string): string[] => {
    const dir = dirFor(lineageId);
    return nodeFs.existsSync(dir)
      ? nodeFs.readdirSync(dir).filter((f) => f.endsWith(".wav"))
      : [];
  };

  const failureOf = (result: RunResult) =>
    JSON.parse(result.stderr.trim()) as { _tag: string; message: string };

  // -----------------------------------------------------------------------
  // add speaks and times the line
  // -----------------------------------------------------------------------

  it("add speaks the line and stores the WAV beside the frame with its duration", async () => {
    const row = await add(s.standaloneActiveId, "Here's the problem.");

    expect(speech.spoken).toEqual(["Here's the problem."]);
    expect(row.durationSeconds).toBe(FAKE_DURATION_SECONDS);
    expect(row.audioPath).toBe(speechFilename("Here's the problem."));

    // Relative to the Video's own directory, never an absolute path.
    expect(nodePath.isAbsolute(row.audioPath!)).toBe(false);
    const full = nodePath.join(
      dirFor(s.standaloneActiveLineageId),
      row.audioPath!
    );
    expect(nodeFs.existsSync(full)).toBe(true);
    // A real WAV: the header is what the cache reads the duration back out of.
    expect(nodeFs.readFileSync(full).subarray(0, 4).toString()).toBe("RIFF");
  });

  it("add reports a duration an agent can sum into a run time", async () => {
    await add(s.standaloneActiveId, "One.");
    await add(s.standaloneActiveId, "Two.");
    await add(s.standaloneActiveId, "Three.");

    const total = (await list(s.standaloneActiveId)).reduce(
      (sum, row) => sum + (row.durationSeconds ?? 0),
      0
    );
    expect(total).toBe(3 * FAKE_DURATION_SECONDS);
  });

  // -----------------------------------------------------------------------
  // the cache
  // -----------------------------------------------------------------------

  it("the same line added twice is spoken once and writes one WAV", async () => {
    const first = await add(s.standaloneActiveId, "Say it again.");
    const second = await add(s.standaloneActiveId, "Say it again.");

    // Two rows, two frames — but one voicing and one file.
    expect(first.id).not.toBe(second.id);
    expect(second.audioPath).toBe(first.audioPath);
    expect(speech.spoken).toEqual(["Say it again."]);
    expect(wavsIn(s.standaloneActiveLineageId)).toHaveLength(1);

    // And the cached file still yields the duration, read off its header.
    expect(second.durationSeconds).toBe(FAKE_DURATION_SECONDS);
  });

  it("the same line twice in ONE batch is spoken once, and both rows share it", async () => {
    const r = await run(
      addArgv(s.standaloneActiveId, [
        { say: "Hold that thought.", image: sourceImage() },
        { say: "Hold that thought.", image: sourceImage() },
      ])
    );

    expect(r.exitCode).toBe(0);
    const [a, b] = ndjson(r.stdout) as Mockup[];
    expect(a!.audioPath).toBe(b!.audioPath);
    expect(a!.durationSeconds).toBe(FAKE_DURATION_SECONDS);
    expect(b!.durationSeconds).toBe(FAKE_DURATION_SECONDS);
    expect(speech.spoken).toEqual(["Hold that thought."]);
    expect(wavsIn(s.standaloneActiveLineageId)).toHaveLength(1);
  });

  it("a batch voices only the lines not already on disk", async () => {
    await add(s.standaloneActiveId, "Already said.");
    speech.spoken.length = 0;

    const r = await run(
      addArgv(s.standaloneActiveId, [
        { say: "Already said.", image: sourceImage() },
        { say: "Brand new.", image: sourceImage() },
      ])
    );

    expect(r.exitCode).toBe(0);
    expect(speech.spoken).toEqual(["Brand new."]);
  });

  it("different lines are different files", async () => {
    const a = await add(s.standaloneActiveId, "One.");
    const b = await add(s.standaloneActiveId, "Two.");

    expect(a.audioPath).not.toBe(b.audioPath);
    expect(speech.spoken).toEqual(["One.", "Two."]);
    expect(wavsIn(s.standaloneActiveLineageId)).toHaveLength(2);
  });

  it("the name is the line, the voice and the model — nothing about the row", async () => {
    const row = await add(s.standaloneActiveId, "A shared line.");

    expect(row.audioPath).not.toContain(row.id);
    expect(row.audioPath).not.toContain(s.standaloneActiveId);
    // The voice and the model are constants, so the same words in another
    // Video land under exactly the same name — in that Video's OWN directory.
    const other = await add(s.lessonVideoId, "A shared line.");
    expect(other.audioPath).toBe(row.audioPath);
    expect(wavsIn(s.lessonVideoLineageId)).toEqual([row.audioPath]);
    // It is the author's voice and the one model, and no verb can choose:
    expect(CLIP_MOCKUP_VOICE).toBe("af_heart");
    expect(CLIP_MOCKUP_TTS_MODEL).toBe("onnx-community/Kokoro-82M-v1.0-ONNX");
  });

  // -----------------------------------------------------------------------
  // update: a new "say"
  // -----------------------------------------------------------------------

  it("update with a new line re-synthesises, replaces the duration, and leaves the image alone", async () => {
    const created = await add(s.standaloneActiveId, "Too dense by half.");
    speech.spoken.length = 0;

    const row = await updateLine(created.id, "Shorter.");

    expect(speech.spoken).toEqual(["Shorter."]);
    expect(row.line).toBe("Shorter.");
    expect(row.audioPath).toBe(speechFilename("Shorter."));
    expect(row.audioPath).not.toBe(created.audioPath);
    expect(row.durationSeconds).toBe(FAKE_DURATION_SECONDS);
    // The picture is untouched, and so is the old WAV — the row is the state.
    expect(row.imagePath).toBe(created.imagePath);
    expect(wavsIn(s.standaloneActiveLineageId).sort()).toEqual(
      [created.audioPath, row.audioPath].sort() as string[]
    );
  });

  it("update with only an image never speaks", async () => {
    const created = await add(s.standaloneActiveId, "The line stays.");
    speech.spoken.length = 0;

    const row = first(
      (await run(updateArgv([{ id: created.id, image: sourceImage() }]))).stdout
    );

    expect(speech.spoken).toEqual([]);
    expect(row.audioPath).toBe(created.audioPath);
    expect(row.durationSeconds).toBe(created.durationSeconds);
  });

  it("update back to a line already voiced reuses the WAV", async () => {
    const created = await add(s.standaloneActiveId, "Original.");
    await updateLine(created.id, "Changed.");
    speech.spoken.length = 0;

    const row = await updateLine(created.id, "Original.");

    expect(speech.spoken).toEqual([]);
    expect(row.audioPath).toBe(created.audioPath);
    expect(row.durationSeconds).toBe(FAKE_DURATION_SECONDS);
  });

  // -----------------------------------------------------------------------
  // the failure path
  // -----------------------------------------------------------------------

  it("a speech failure on add names itself, exits 4, and leaves no row and no file", async () => {
    const r = await runFailing(
      addArgv(s.standaloneActiveId, [
        { say: "Never spoken.", image: sourceImage() },
      ])
    );

    // An internal failure, not bad input: exit 4, the CLI's existing code.
    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    const failure = failureOf(r);
    expect(failure._tag).toBe("SpeechSynthesisError");
    expect(failure.message).toBe(SPEECH_FAILURE_MESSAGE);

    // No row...
    expect(await list(s.standaloneActiveId)).toEqual([]);
    // ...and not one orphan byte: no frame is written until every line of
    // the batch has been spoken, so a refusal never half-creates a Clip
    // Mockup.
    expect(nodeFs.existsSync(dirFor(s.standaloneActiveLineageId))).toBe(false);
  });

  it("a speech failure on update changes nothing", async () => {
    const created = await add(s.standaloneActiveId, "The original line.");
    const before = nodeFs
      .readdirSync(dirFor(s.standaloneActiveLineageId))
      .sort();

    const r = await runFailing(
      updateArgv([{ id: created.id, say: "Never spoken." }])
    );

    expect(r.exitCode).toBe(4);
    expect(failureOf(r)._tag).toBe("SpeechSynthesisError");

    const [row] = await list(s.standaloneActiveId);
    expect(row).toMatchObject({
      line: "The original line.",
      audioPath: created.audioPath,
      durationSeconds: created.durationSeconds,
    });
    expect(
      nodeFs.readdirSync(dirFor(s.standaloneActiveLineageId)).sort()
    ).toEqual(before);
  });
});
