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
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import {
  failingSpeech,
  fakeSpeech,
  makeClipMockupRun,
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
// `cvm footage` suite replaces VideoProcessingService: NO GEMINI CALL EVER
// RUNS HERE, and `speech.spoken` is the record of what the command actually
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

  const obj = (stdout: string): Mockup => one<Mockup>(stdout);

  let frameCounter = 0;
  const sourceImage = (): string => {
    const full = nodePath.join(sourceDir, `frame-${frameCounter++}.png`);
    nodeFs.writeFileSync(full, "PNG-BYTES");
    return full;
  };

  const addRaw = (videoId: string, line: string): Promise<RunResult> =>
    run([
      "clip-mockup",
      "add",
      "--video",
      videoId,
      "--image",
      sourceImage(),
      "--say",
      line,
    ]);

  const add = async (videoId: string, line: string): Promise<Mockup> =>
    obj((await addRaw(videoId, line)).stdout);

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
    expect(CLIP_MOCKUP_VOICE).toBe("Leda");
    expect(CLIP_MOCKUP_TTS_MODEL).toBe("gemini-2.5-flash-preview-tts");
  });

  // -----------------------------------------------------------------------
  // update --say
  // -----------------------------------------------------------------------

  it("update --say re-synthesises, replaces the duration, and leaves the image alone", async () => {
    const created = await add(s.standaloneActiveId, "Too dense by half.");
    speech.spoken.length = 0;

    const row = obj(
      (await run(["clip-mockup", "update", "--say", "Shorter.", created.id]))
        .stdout
    );

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

  it("update --image alone never speaks", async () => {
    const created = await add(s.standaloneActiveId, "The line stays.");
    speech.spoken.length = 0;

    const row = obj(
      (
        await run([
          "clip-mockup",
          "update",
          "--image",
          sourceImage(),
          created.id,
        ])
      ).stdout
    );

    expect(speech.spoken).toEqual([]);
    expect(row.audioPath).toBe(created.audioPath);
    expect(row.durationSeconds).toBe(created.durationSeconds);
  });

  it("update --say back to a line already voiced reuses the WAV", async () => {
    const created = await add(s.standaloneActiveId, "Original.");
    await run(["clip-mockup", "update", "--say", "Changed.", created.id]);
    speech.spoken.length = 0;

    const row = obj(
      (await run(["clip-mockup", "update", "--say", "Original.", created.id]))
        .stdout
    );

    expect(speech.spoken).toEqual([]);
    expect(row.audioPath).toBe(created.audioPath);
    expect(row.durationSeconds).toBe(FAKE_DURATION_SECONDS);
  });

  // -----------------------------------------------------------------------
  // the failure path
  // -----------------------------------------------------------------------

  it("a speech failure on add names itself, exits 4, and leaves no row and no file", async () => {
    const r = await runFailing([
      "clip-mockup",
      "add",
      "--video",
      s.standaloneActiveId,
      "--image",
      sourceImage(),
      "--say",
      "Never spoken.",
    ]);

    // An internal failure, not bad input: exit 4, the CLI's existing code.
    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    const failure = failureOf(r);
    expect(failure._tag).toBe("SpeechSynthesisError");
    expect(failure.message).toBe(SPEECH_FAILURE_MESSAGE);

    // No row...
    expect(await list(s.standaloneActiveId)).toEqual([]);
    // ...and not one orphan byte: the line is spoken before the frame is
    // written, so a refusal never half-creates a Clip Mockup.
    expect(nodeFs.existsSync(dirFor(s.standaloneActiveLineageId))).toBe(false);
  });

  it("a speech failure on update --say changes nothing", async () => {
    const created = await add(s.standaloneActiveId, "The original line.");
    const before = nodeFs
      .readdirSync(dirFor(s.standaloneActiveLineageId))
      .sort();

    const r = await runFailing([
      "clip-mockup",
      "update",
      "--say",
      "Never spoken.",
      created.id,
    ]);

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
