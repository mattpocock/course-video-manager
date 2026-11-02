import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Data, Deferred, Effect, Fiber, Layer, Logger, LogLevel } from "effect";
import { NodeContext } from "@effect/platform-node";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { runSidecar } from "../../sidecar/sidecar";
import { transcribeFootageJobKind } from "../../sidecar/kinds/transcribe-footage";
import { importFootageJobKind } from "../../sidecar/kinds/import-footage";
import {
  FootageProbe,
  FootageUnreadableError,
  type FootageProbeResult,
} from "@/services/footage-probe";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  one,
  ndjson,
  seedWrite,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm footage: list / transcribe / transcript
//
// Footage has NO database row — its identity is a path and its transcript is a
// sidecar file on disk. `transcribe` enqueues a `transcribe-footage` Job, so a
// REAL Sidecar (`runSidecar`) runs here on the same PGlite database, and only
// its WhisperTranscriptionService is FAKED via
// Layer.succeed(WhisperTranscriptionService, {...}) — the same pattern as
// render-vertical-video-service.test.ts — so NO real ffmpeg / OpenAI ever
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

class CouldNotTranscribeError extends Data.TaggedError(
  "CouldNotTranscribeError"
)<{ message: string }> {}

/** Set to make the fake Whisper fail, as a refused upload does. */
let whisperFails = false;

// A fake whose transcribeFootageFile ignores its input and returns a canned
// transcript — the Job under test is what hashes the source and writes the
// sidecar, so this never has to be real.
const fakeWhisper = Layer.succeed(WhisperTranscriptionService, {
  transcribeFootageFile: () =>
    whisperFails
      ? Effect.fail(
          new CouldNotTranscribeError({
            message: "Whisper API call failed: Error: Connection error.",
          })
        )
      : Effect.succeed(FAKE_TRANSCRIPT),
} as unknown as WhisperTranscriptionService);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let jobsLayer: Layer.Layer<JobOperationsService>;
let stopSidecar: Deferred.Deferred<string>;
let sidecarFiber: Fiber.RuntimeFiber<unknown, unknown>;
let footageDir: string;
/** The Storage Roots, in order: an import goes to the first. */
let roots: [string, string];
/** What the faked ffprobe answers, by file name; absent, it can't read it. */
let probed: Record<string, FootageProbeResult> = {};
const fakeProbe = Layer.succeed(FootageProbe, {
  probe: (file) =>
    probed[nodePath.basename(file)]
      ? Effect.succeed(probed[nodePath.basename(file)]!)
      : Effect.fail(new FootageUnreadableError({ message: "moov not found" })),
});
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];
const originalObsDir = process.env.OBS_RECORDING_DIR;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  jobsLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  const layer = Layer.mergeAll(buildWriteLayer(testDb), jobsLayer, fakeProbe);
  run = async (argv) => {
    const out = makeTestCliOutput();
    const exitCode = await Effect.runPromise(
      buildProgram(argv).pipe(Effect.provide(out.layer), Effect.provide(layer))
    );
    return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
  };

  process.env[LOCAL_MACHINE_ENV_KEY] = "true";

  // The Sidecar that runs the `transcribe-footage` Jobs the command enqueues.
  stopSidecar = Effect.runSync(Deferred.make<string>());
  sidecarFiber = Effect.runFork(
    runSidecar({
      identity: {
        holder: "footage-test",
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/footage",
        gitSha: "abc1234",
        socket: nodePath.join(os.tmpdir(), "cvm-footage-test.sock"),
      },
      registry: {
        "transcribe-footage": transcribeFootageJobKind,
        "import-footage": importFootageJobKind,
      },
      timing: {
        leaseMs: 5_000,
        leaseRenewMs: 1_000,
        jobLeaseMs: 5_000,
        jobHeartbeatMs: 1_000,
        pollMs: 20,
        recoverEveryMs: 1_000,
        lapseWaitMs: 200,
        postCheckTimeoutMs: 1_000,
      },
      stop: stopSidecar,
      serve: () => Effect.void,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          jobsLayer,
          fakeWhisper,
          NodeContext.layer,
          SidecarContextTest
        )
      ),
      Logger.withMinimumLogLevel(LogLevel.None)
    )
  );
});

afterAll(async () => {
  await Effect.runPromise(
    Deferred.succeed(stopSidecar, "test over").pipe(
      Effect.zipRight(Fiber.join(sidecarFiber))
    )
  );
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
  if (originalObsDir === undefined) delete process.env.OBS_RECORDING_DIR;
  else process.env.OBS_RECORDING_DIR = originalObsDir;
  delete process.env.STORAGE_ROOTS;
});

beforeEach(() => {
  whisperFails = false;
  footageDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-footage-"));
  // footage list without --dir reads OBS_RECORDING_DIR.
  process.env.OBS_RECORDING_DIR = footageDir;
  const base = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-roots-"));
  roots = [nodePath.join(base, "d"), nodePath.join(base, "e")];
  for (const root of roots) nodeFs.mkdirSync(root);
  process.env.STORAGE_ROOTS = roots.join(",");
  probed = {
    "interview.mp4": {
      video: { width: 1920, height: 1080, sampleAspectRatio: "1:1" },
      durationSeconds: 3,
    },
    "square.mp4": {
      video: { width: 1440, height: 1080, sampleAspectRatio: "1:1" },
      durationSeconds: 3,
    },
  };
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
});

describe("footage on a Recording Session's mic file", () => {
  it("lists the mic file of each Recording Session folder, and transcribes it", async () => {
    // The CVM recorder writes each Recording Session into a folder of its
    // own beside the OBS recordings: camera, screen and mic.
    const session = nodePath.join(footageDir, "2026-10-12T10-00-00 abcd1234");
    nodeFs.mkdirSync(session);
    for (const name of ["camera.mkv", "screen.mkv", "mic.mkv"]) {
      nodeFs.writeFileSync(nodePath.join(session, name), name);
    }
    const obs = footageFile("2026-10-11 09-00-00.mkv", "obs");
    const mic = nodePath.join(session, "mic.mkv");

    const listed = () =>
      run(["footage", "list"]).then(
        (r) => ndjson(r.stdout) as Array<{ path: string; transcribed: boolean }>
      );
    expect((await listed()).map((x) => x.path)).toEqual([obs, mic]);

    const summary = one<TranscribeSummary>(
      (await run(["footage", "transcribe", mic])).stdout
    );
    expect(summary).toMatchObject({ path: mic, sidecar: sidecarOf(mic) });
    expect((await listed())[1]).toEqual({
      path: mic,
      size: "mic.mkv".length,
      transcribed: true,
    });
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

  it("ends as the in-process command did when Whisper fails: its tag, exit 4", async () => {
    whisperFails = true;
    const file = footageFile("take.mkv", "the-bytes");
    const r = await run(["footage", "transcribe", file]);

    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr.trim())).toEqual({
      _tag: "CouldNotTranscribeError",
      message: "Whisper API call failed: Error: Connection error.",
    });
    expect(nodeFs.existsSync(sidecarOf(file))).toBe(false);
  });

  it("--no-wait prints the queued Job and returns", async () => {
    const file = footageFile("take.mkv", "the-bytes");
    const r = await run(["footage", "transcribe", "--no-wait", file]);

    expect(r.exitCode).toBe(0);
    const queued = one<{ jobId: string; status: string; path: string }>(
      r.stdout
    );
    expect(queued).toMatchObject({
      status: "queued",
      path: nodePath.resolve(file),
    });
    const job = await Effect.runPromise(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.getJob(queued.jobId)
      ).pipe(Effect.provide(jobsLayer))
    );
    expect(job).toMatchObject({
      kind: "transcribe-footage",
      params: { path: nodePath.resolve(file) },
      subjectType: "footage",
      subjectId: nodePath.resolve(file),
    });
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

describe("footage import", () => {
  const imported = (name: string) =>
    nodePath.join(roots[0], "raw-footage", "imported", name);
  const importOf = async (file: string, ...flags: string[]) => {
    const r = await run(["footage", "import", ...flags, file]);
    return { ...r, out: r.exitCode === 0 ? one<ImportResult>(r.stdout) : null };
  };
  const jobCount = () =>
    Effect.runPromise(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.listRecentJobs({ finishedWithinMs: 3_600_000 })
      ).pipe(Effect.provide(jobsLayer))
    ).then((jobs) => jobs.length);

  interface ImportResult {
    path: string;
    size: number;
    width: number;
    height: number;
    durationSeconds: number;
    transcript: { words: number; segments: number };
  }

  it("copies a 16:9 file into raw-footage/imported/ on the first Storage Root and transcribes it, leaving the source as it was", async () => {
    const source = footageFile("interview.mp4", "streamyard bytes");
    const r = await importOf(source);

    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual({
      path: "raw-footage/imported/interview.mp4",
      size: "streamyard bytes".length,
      width: 1920,
      height: 1080,
      durationSeconds: 3,
      transcript: { words: 3, segments: 1 },
    });
    expect(nodeFs.readFileSync(source, "utf8")).toBe("streamyard bytes");
    expect(nodeFs.readFileSync(imported("interview.mp4"), "utf8")).toBe(
      "streamyard bytes"
    );
    expect(nodeFs.existsSync(sidecarOf(imported("interview.mp4")))).toBe(true);

    const listed = ndjson(
      (await run(["footage", "list", "--imported"])).stdout
    );
    expect(listed).toEqual([
      { path: r.out!.path, size: r.out!.size, transcribed: true },
    ]);

    const s = await seedWrite(testDb);
    const clip = one<{ videoFilename: string; origin: string }>(
      (
        await run([
          "clip",
          "add",
          "--video",
          s.standaloneActiveId,
          "--source",
          r.out!.path,
          "--start",
          "0",
          "--end",
          "2",
        ])
      ).stdout
    );
    expect(clip).toMatchObject({ videoFilename: r.out!.path, origin: "cli" });
  });

  it("refuses a 4:3 file or one ffprobe can't read (exit 3), copying nothing and queueing no Job", async () => {
    const before = await jobCount();
    for (const name of ["square.mp4", "broken.mp4"]) {
      const r = await importOf(footageFile(name, "bytes"));
      expect(r.exitCode).toBe(3);
      expect(r.stdout).toBe("");
    }
    expect(
      JSON.parse((await importOf(footageFile("square.mp4", "b"))).stderr)
        .message
    ).toContain("1440x1080");
    expect(nodeFs.existsSync(nodePath.dirname(imported("x")))).toBe(false);
    expect(await jobCount()).toBe(before);
  });

  it("gives back the same path for the same file, and a -2 name for different bytes under the same name", async () => {
    const source = footageFile("interview.mp4", "first");
    const first = await importOf(source);
    const again = await importOf(source);
    expect(again.out!.path).toBe(first.out!.path);

    nodeFs.writeFileSync(source, "a different interview");
    const other = await importOf(source);
    expect(other.out!.path).toBe("raw-footage/imported/interview-2.mp4");
    expect(nodeFs.readdirSync(nodePath.dirname(imported("x"))).sort()).toEqual([
      "interview-2.mp4",
      "interview-2.mp4.transcript.json",
      "interview.mp4",
      "interview.mp4.transcript.json",
    ]);
  });

  it("never takes a cut-off copy's partial for the file, and --no-wait prints the queued Jobs", async () => {
    nodeFs.mkdirSync(nodePath.dirname(imported("x")), { recursive: true });
    nodeFs.writeFileSync(
      `${imported("interview.mp4")}.cvm-import-partial`,
      "f"
    );
    const source = footageFile("interview.mp4", "full bytes");

    const r = await importOf(source, "--no-wait");
    expect(r.out).toMatchObject({
      status: "queued",
      path: "raw-footage/imported/interview.mp4",
      jobId: expect.any(String),
      transcribeJobId: expect.any(String),
    });
    const done = await importOf(source);
    expect(done.out!.path).toBe(r.out!.path);
    expect(nodeFs.readFileSync(imported("interview.mp4"), "utf8")).toBe(
      "full bytes"
    );
    expect(
      nodeFs.existsSync(`${imported("interview.mp4")}.cvm-import-partial`)
    ).toBe(false);
  });
});

describe("footage search", () => {
  it("finds a word per segment in fresh Imported Footage transcripts only, and names stale ones on STDERR", async () => {
    await run(["footage", "import", footageFile("interview.mp4", "v1")]);
    const outside = nodePath.join(roots[1], "raw-footage", "take.mp4");
    nodeFs.mkdirSync(nodePath.dirname(outside), { recursive: true });
    nodeFs.writeFileSync(outside, "not imported");
    await run(["footage", "transcribe", outside]);

    const r = await run(["footage", "search", "WORLD"]);
    expect(ndjson(r.stdout)).toEqual([
      {
        path: "raw-footage/imported/interview.mp4",
        start: 0,
        end: 3,
        text: "hello world again",
      },
    ]);
    expect(r.stderr).toBe("");

    const file = nodePath.join(roots[0], "raw-footage/imported/interview.mp4");
    nodeFs.writeFileSync(file, "bytes changed since transcribed");
    const stale = await run(["footage", "search", "world"]);
    expect([stale.exitCode, stale.stdout]).toEqual([0, ""]);
    expect(JSON.parse(stale.stderr)).toEqual({
      notTranscribed: ["raw-footage/imported/interview.mp4"],
    });

    expect((await run(["footage", "search", "  "])).exitCode).toBe(3);
  });
});
