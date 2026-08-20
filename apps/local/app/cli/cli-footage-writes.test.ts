import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { createTestDb, type TestDb } from "@/test-utils/pglite";
import { VideoProcessingService } from "@/services/video-processing-service";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  one,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm footage: list / transcribe / transcript
//
// Footage has NO database row — its identity is a path and its transcript is a
// sidecar file on disk. These verbs touch the DISK (and would run ffmpeg +
// Whisper), so the whole VideoProcessingService is FAKED via
// Layer.succeed(VideoProcessingService, {...}) — the same pattern as
// render-vertical-video-service.test.ts — and NO real ffmpeg / OpenAI ever
// runs. Touching the disk is also what makes footage LOCAL-ONLY, so the suite
// declares the machine local the way cli-file-writes.test.ts does; the refusals
// live in cli-local-only.test.ts.
// ===========================================================================

const FAKE_TRANSCRIPT = {
  words: [
    { start: 0, end: 1, text: "hello" },
    { start: 1, end: 2, text: "world" },
    { start: 2, end: 3, text: "again" },
  ],
  segments: [{ start: 0, end: 3, text: " hello world again" }],
};

// A fake whose transcribeFootageFile ignores its input and returns a canned
// transcript — the command under test is what hashes the source and writes the
// sidecar, so this never has to be real.
const fakeVideoProcessing = Layer.succeed(VideoProcessingService, {
  transcribeFootageFile: () => Effect.succeed(FAKE_TRANSCRIPT),
} as unknown as VideoProcessingService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let footageDir: string;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];
const originalObsDir = process.env.OBS_RECORDING_DIR;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const layer = Layer.merge(buildWriteLayer(testDb), fakeVideoProcessing);
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };

  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
  if (originalObsDir === undefined) delete process.env.OBS_RECORDING_DIR;
  else process.env.OBS_RECORDING_DIR = originalObsDir;
});

beforeEach(() => {
  footageDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-footage-"));
  // footage list without --dir reads OBS_RECORDING_DIR (see getLatestOBSVideoClips).
  process.env.OBS_RECORDING_DIR = footageDir;
});

/** Write a fake footage file with the given bytes, returning its path. */
const footageFile = (name: string, bytes: string): string => {
  const full = nodePath.join(footageDir, name);
  nodeFs.writeFileSync(full, bytes);
  return full;
};

const sidecarOf = (sourcePath: string): string =>
  sourcePath + ".transcript.json";

interface TranscribeSummary {
  path: string;
  sidecar: string;
  sourceHash: string;
  transcribedAt: string;
  words: number;
  segments: number;
}

describe("footage list", () => {
  it("lists only video files, sorted, with size + transcribed flag", async () => {
    footageFile("b-take.mkv", "bbbb");
    footageFile("a-take.mp4", "aaa");
    footageFile("notes.txt", "not a video");

    const r = await run(["footage", "list"]);
    expect(r.exitCode).toBe(0);
    const rows = ndjson(r.stdout) as Array<{
      path: string;
      size: number;
      transcribed: boolean;
    }>;
    expect(rows.map((x) => nodePath.basename(x.path))).toEqual([
      "a-take.mp4",
      "b-take.mkv",
    ]);
    expect(rows[0]).toMatchObject({ size: 3, transcribed: false });
    expect(rows[1]).toMatchObject({ size: 4, transcribed: false });
  });

  it("reports transcribed:true once a sidecar exists, and honours --dir", async () => {
    const other = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-foot2-"));
    try {
      const file = nodePath.join(other, "clip.mov");
      nodeFs.writeFileSync(file, "xyz");
      await run(["footage", "transcribe", file]);

      const rows = ndjson(
        (await run(["footage", "list", "--dir", other])).stdout
      ) as Array<{ path: string; transcribed: boolean }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.transcribed).toBe(true);
    } finally {
      nodeFs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("prints nothing (exit 0) for an empty directory", async () => {
    const r = await run(["footage", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("footage transcribe", () => {
  it("writes a sidecar next to the source and echoes a summary", async () => {
    const file = footageFile("take.mkv", "the-bytes");
    const r = await run(["footage", "transcribe", file]);

    expect(r.exitCode).toBe(0);
    const summary = one<TranscribeSummary>(r.stdout);
    expect(summary.path).toBe(nodePath.resolve(file));
    expect(summary.sidecar).toBe(sidecarOf(file));
    expect(summary.words).toBe(3);
    expect(summary.segments).toBe(1);
    expect(summary.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    // The sidecar is real, on disk, keyed by the content hash.
    const sidecar = JSON.parse(nodeFs.readFileSync(sidecarOf(file), "utf8"));
    expect(sidecar.sourceHash).toBe(summary.sourceHash);
    expect(sidecar.words).toEqual(FAKE_TRANSCRIPT.words);
    expect(sidecar.segments).toEqual(FAKE_TRANSCRIPT.segments);
  });

  it("is invalid input (exit 3) for a source that does not exist", async () => {
    const r = await run([
      "footage",
      "transcribe",
      nodePath.join(footageDir, "nope.mp4"),
    ]);
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toBe("");
    expect((JSON.parse(r.stderr.trim()) as { _tag: string })._tag).toBe(
      "ParseError"
    );
  });

  it("re-transcribes (new hash) when the file's bytes change", async () => {
    const file = footageFile("take.mkv", "first-recording");
    const first = one<TranscribeSummary>(
      (await run(["footage", "transcribe", file])).stdout
    );

    nodeFs.writeFileSync(file, "a totally different re-recording");
    const second = one<TranscribeSummary>(
      (await run(["footage", "transcribe", file])).stdout
    );

    expect(second.sourceHash).not.toBe(first.sourceHash);
  });
});

describe("footage transcript", () => {
  it("reads back the cached words + segments", async () => {
    const file = footageFile("take.mkv", "bytes");
    await run(["footage", "transcribe", file]);

    const r = await run(["footage", "transcript", file]);
    expect(r.exitCode).toBe(0);
    const t = one<{
      path: string;
      words: typeof FAKE_TRANSCRIPT.words;
      segments: typeof FAKE_TRANSCRIPT.segments;
    }>(r.stdout);
    expect(t.path).toBe(nodePath.resolve(file));
    expect(t.words).toEqual(FAKE_TRANSCRIPT.words);
    expect(t.segments).toEqual(FAKE_TRANSCRIPT.segments);
  });

  it("is a not-found (exit 2) when never transcribed", async () => {
    const file = footageFile("take.mkv", "bytes");
    const r = await run(["footage", "transcript", file]);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe("");
    expect((JSON.parse(r.stderr.trim()) as { _tag: string })._tag).toBe(
      "NotFoundError"
    );
  });

  it("is a not-found (exit 2) when the sidecar is stale (bytes changed)", async () => {
    const file = footageFile("take.mkv", "original bytes");
    await run(["footage", "transcribe", file]);
    // Replace the file's bytes WITHOUT re-transcribing: the cached hash no
    // longer matches, so the transcript is treated as absent.
    nodeFs.writeFileSync(file, "replaced bytes, sidecar now stale");

    const r = await run(["footage", "transcript", file]);
    expect(r.exitCode).toBe(2);
  });
});
