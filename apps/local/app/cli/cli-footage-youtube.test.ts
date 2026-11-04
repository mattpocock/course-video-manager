import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger, LogLevel } from "effect";
import { NodeContext } from "@effect/platform-node";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { IMPORT_YOUTUBE_FOOTAGE_JOB_KIND } from "@/features/jobs/import-youtube-footage-job";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";
import { FootageProbe } from "@/services/footage-probe";
import { runSidecar } from "../../sidecar/sidecar";
import { transcribeFootageJobKind } from "../../sidecar/kinds/transcribe-footage";
import { importYoutubeFootageJobKind } from "../../sidecar/kinds/import-youtube-footage";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import { buildWriteLayer, one, type RunResult } from "./cli-write-test-harness";

// ===========================================================================
// cvm footage import <youtube-url> (#2545)
//
// A REAL Sidecar runs the `import-youtube-footage` and `transcribe-footage`
// Jobs on PGlite. `yt-dlp` is a STUB on the PATH: a shell script that logs
// the URL it was asked for and writes a small synthetic file and info JSON
// where CVM's `--output` says. Nothing reaches YouTube. ffprobe and Whisper
// are faked at their seams, so the suite needs no ffmpeg.
// ===========================================================================

const VIDEO_ID = "aB3_dEf-9Hi";
/** The stub's video for this id is 4:3. */
const SQUARE_ID = "sqUare4x3Id";

/** The stub, logging to `log`, its every video titled "Live: Q&A / part 1?". */
const stub = (log: string) => `#!/bin/sh
out=""; prev=""; url=""; skip=""
for a in "$@"; do
  if [ "$prev" = "--output" ]; then out="$a"; fi
  if [ "$a" = "--skip-download" ]; then skip=1; fi
  prev="$a"; url="$a"
done
echo "$url" >> "${log}"
base="\${out%.%(ext)s}"
echo "cvm-progress 5 10"
echo "cvm-progress 10 10"
[ -n "$skip" ] || printf 'synthetic media of %s' "$url" > "$base.mp4"
printf '{"id":"x","title":"Live: Q&A / part 1?"}' > "$base.info.json"
`;

const fakeWhisper = Layer.succeed(WhisperTranscriptionService, {
  transcribeFootageFile: () =>
    Effect.succeed({
      words: [{ start: 0, end: 1, text: "hello" }],
      segments: [{ start: 0, end: 1, text: " hello" }],
    }),
} as unknown as WhisperTranscriptionService);

const fakeProbe = Layer.succeed(FootageProbe, {
  probe: (file) =>
    Effect.succeed({
      video: file.includes(SQUARE_ID)
        ? { width: 1440, height: 1080, sampleAspectRatio: "1:1" }
        : { width: 1920, height: 1080, sampleAspectRatio: "1:1" },
      durationSeconds: 1,
    }),
});

let testDb: TestDb;
let jobsLayer: Layer.Layer<JobOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let stopSidecar: Deferred.Deferred<string>;
let sidecarFiber: Fiber.RuntimeFiber<unknown, unknown>;
let root: string;
let stubLog: string;
const stubDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-yt-stub-"));
const originalPath = process.env.PATH;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
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

  stopSidecar = Effect.runSync(Deferred.make<string>());
  sidecarFiber = Effect.runFork(
    runSidecar({
      identity: {
        holder: "youtube-import-test",
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/youtube",
        gitSha: "abc1234",
        socket: nodePath.join(os.tmpdir(), "cvm-youtube-test.sock"),
      },
      registry: {
        "import-youtube-footage": importYoutubeFootageJobKind,
        "transcribe-footage": transcribeFootageJobKind,
      },
      timing: {
        leaseMs: 5_000,
        outageToleranceMs: 10_000,
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
          fakeProbe,
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
  process.env.PATH = originalPath;
  if (originalLocalMachine === undefined) {
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  } else {
    process.env[LOCAL_MACHINE_ENV_KEY] = originalLocalMachine;
  }
  delete process.env.STORAGE_ROOTS;
});

beforeEach(() => {
  root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-yt-root-"));
  process.env.STORAGE_ROOTS = root;
  stubLog = nodePath.join(root, "..", `${nodePath.basename(root)}.log`);
  nodeFs.writeFileSync(nodePath.join(stubDir, "yt-dlp"), stub(stubLog), {
    mode: 0o755,
  });
  process.env.PATH = `${stubDir}:${originalPath}`;
});

const importedDir = () => nodePath.join(root, "raw-footage", "imported");
const downloads = () =>
  nodeFs.existsSync(stubLog)
    ? nodeFs.readFileSync(stubLog, "utf8").trim().split("\n")
    : [];
const staging = (id: string) =>
  nodePath.join(os.tmpdir(), "cvm-youtube-import", id);

describe("footage import <youtube-url>", () => {
  it("downloads the video, imports it as '<title> [<id>].mp4' with its title and URL kept, transcribes it, and reuses it for a second import of the same id", async () => {
    const r = await run([
      "footage",
      "import",
      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=42s`,
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    const name = `Live Q&A part 1 [${VIDEO_ID}].mp4`;
    const watchUrl = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    expect(one(r.stdout)).toEqual({
      path: `raw-footage/imported/${name}`,
      size: `synthetic media of ${watchUrl}`.length,
      width: 1920,
      height: 1080,
      durationSeconds: 1,
      transcript: { words: 1, segments: 1 },
      title: "Live: Q&A / part 1?",
      url: watchUrl,
    });
    expect(nodeFs.readdirSync(importedDir()).sort()).toEqual([
      name,
      `${name}.transcript.json`,
      `${name}.youtube.json`,
    ]);
    expect(nodeFs.existsSync(staging(VIDEO_ID))).toBe(false);

    const again = await run([
      "footage",
      "import",
      `https://youtu.be/${VIDEO_ID}`,
    ]);
    expect(one(again.stdout)).toMatchObject({
      path: `raw-footage/imported/${name}`,
    });
    expect(downloads()).toEqual([watchUrl]);
  });

  it("refuses a video that is not 16:9 after the download, leaving nothing under raw-footage/imported/, and refuses a URL that is not a YouTube video (exit 3)", async () => {
    const r = await run([
      "footage",
      "import",
      `https://www.youtube.com/shorts/${SQUARE_ID}`,
    ]);
    expect(r.exitCode).not.toBe(0);
    expect(JSON.parse(r.stderr).message).toContain("1440x1080");
    expect(downloads()).toHaveLength(1);
    expect(nodeFs.existsSync(importedDir())).toBe(false);
    expect(nodeFs.existsSync(staging(SQUARE_ID))).toBe(false);

    const notYoutube = await run([
      "footage",
      "import",
      "https://vimeo.com/123456789",
    ]);
    expect(notYoutube.exitCode).toBe(3);
  });

  it("keeps the title and URL of a video a cut-off run placed without them", async () => {
    const name = `Live Q&A part 1 [${VIDEO_ID}].mp4`;
    const url = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    nodeFs.mkdirSync(importedDir(), { recursive: true });
    nodeFs.writeFileSync(nodePath.join(importedDir(), name), "placed bytes");

    const job = Effect.gen(function* () {
      const { id } = yield* enqueueJob({
        id: null,
        kind: IMPORT_YOUTUBE_FOOTAGE_JOB_KIND,
        title: "Import",
        params: { url, videoId: VIDEO_ID },
        dependsOn: null,
        subject: null,
        attemptsSpent: 0,
        registry: JOB_KIND_SPECS,
      });
      const ops = yield* JobOperationsService;
      let now = yield* ops.getJob(id);
      for (; now?.status === "queued" || now?.status === "running";) {
        now = yield* Effect.zipRight(Effect.sleep(20), ops.getJob(id));
      }
      return now?.status;
    });
    expect(await Effect.runPromise(Effect.provide(job, jobsLayer))).toBe(
      "succeeded"
    );
    const kept = nodePath.join(importedDir(), `${name}.youtube.json`);
    expect(JSON.parse(nodeFs.readFileSync(kept, "utf8"))).toEqual({
      url,
      title: "Live: Q&A / part 1?",
      videoId: VIDEO_ID,
    });
    expect(
      nodeFs.readFileSync(nodePath.join(importedDir(), name), "utf8")
    ).toBe("placed bytes");
    expect(nodeFs.existsSync(staging(VIDEO_ID))).toBe(false);
  });

  it("fails naming how to install yt-dlp when it is not on the Sidecar's PATH", async () => {
    process.env.PATH = nodeFs.mkdtempSync(
      nodePath.join(os.tmpdir(), "cvm-empty-")
    );
    const r = await run([
      "footage",
      "import",
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    ]);
    expect(r.exitCode).not.toBe(0);
    expect(JSON.parse(r.stderr).message).toContain(
      "yt-dlp is not on the Sidecar's PATH"
    );
    expect(nodeFs.existsSync(importedDir())).toBe(false);
  });
});
