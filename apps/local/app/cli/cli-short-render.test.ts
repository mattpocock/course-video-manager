import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger, LogLevel } from "effect";
import { NodeContext } from "@effect/platform-node";
import os from "node:os";
import nodePath from "node:path";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import {
  RenderVerticalError,
  RenderVerticalVideoService,
} from "@/services/render-vertical-video-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { runSidecar } from "../../sidecar/sidecar";
import { renderVerticalJobKind } from "../../sidecar/kinds/render-vertical";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeRun,
  one,
  type RunResult,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm short render
//
// The command enqueues the `render-vertical` Job, so a REAL Sidecar runs here
// on the same PGlite database, with only its RenderVerticalVideoService FAKED —
// as cli-footage-writes.test.ts fakes Whisper — so no ffmpeg ever runs. The
// refusal on a Remote Box lives in cli-local-only.test.ts.
// ===========================================================================

/** Set to make the fake render fail, as a broken overlay renderer does. */
let renderFails = false;
const rendered: string[] = [];

const fakeRender = Layer.succeed(
  RenderVerticalVideoService,
  RenderVerticalVideoService.make({
    renderVerticalVideo: (opts) =>
      Effect.gen(function* () {
        rendered.push(opts.videoId);
        if (renderFails) {
          return yield* new RenderVerticalError({
            cause: null,
            message: "Overlay renderer exited with code 1: boom",
          });
        }
        return `/finished-videos/${opts.videoId}.mp4`;
      }),
  })
);

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let jobsLayer: Layer.Layer<JobOperationsService>;
let stopSidecar: Deferred.Deferred<string>;
let sidecarFiber: Fiber.RuntimeFiber<unknown, unknown>;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  jobsLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(
    Layer.mergeAll(buildWriteLayer(testDb), jobsLayer) as ReturnType<
      typeof buildWriteLayer
    >
  );
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";

  stopSidecar = Effect.runSync(Deferred.make<string>());
  sidecarFiber = Effect.runFork(
    runSidecar({
      identity: {
        holder: "short-render-test",
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/short-render",
        gitSha: "abc1234",
        socket: nodePath.join(os.tmpdir(), "cvm-short-render-test.sock"),
      },
      registry: { "render-vertical": renderVerticalJobKind },
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
          fakeRender,
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
});

let short: string;
let landscape: string;

const video = async (format: "short" | "landscape") => {
  const [v] = await testDb
    .insert(schema.videos)
    .values({ title: `${format}.mp4`, originalFootagePath: "f.mp4", format })
    .returning();
  return v!.id;
};

const jobs = () =>
  Effect.runPromise(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.listRecentJobs({ finishedWithinMs: 3_600_000 })
    ).pipe(Effect.provide(jobsLayer))
  );

// No truncation between tests: it would take the running Sidecar's lease.
beforeEach(async () => {
  short = await video("short");
  landscape = await video("landscape");
  renderFails = false;
  rendered.length = 0;
});

describe("short render", () => {
  it("runs the vertical render Job for the Short and prints the finished file", async () => {
    const r = await run(["short", "render", short]);

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toEqual({
      videoId: short,
      path: `/finished-videos/${short}.mp4`,
    });
    expect(rendered).toEqual([short]);
  });

  it("--no-wait prints the queued Job and returns", async () => {
    const r = await run(["short", "render", "--no-wait", short]);

    expect(r.exitCode).toBe(0);
    const queued = one<{ jobId: string; status: string; videoId: string }>(
      r.stdout
    );
    expect(queued).toMatchObject({ status: "queued", videoId: short });
    const job = await Effect.runPromise(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.getJob(queued.jobId)
      ).pipe(Effect.provide(jobsLayer))
    );
    expect(job).toMatchObject({
      kind: "render-vertical",
      params: { videoId: short },
      subjectType: "video",
      subjectId: short,
    });
  });

  it("prints the render's own reason and exits non-zero when the Job fails", async () => {
    renderFails = true;
    const r = await run(["short", "render", short]);

    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr.trim())).toMatchObject({
      _tag: "RenderVerticalError",
      message: "Overlay renderer exited with code 1: boom",
    });
  });

  it("refuses a Landscape Video (exit 3) and an unknown one (exit 2), queueing no Job", async () => {
    const before = (await jobs()).length;

    const wide = await run(["short", "render", landscape]);
    expect(wide.exitCode).toBe(3);
    expect(wide.stdout).toBe("");
    expect(JSON.parse(wide.stderr.trim()).message).toContain("Landscape");

    const missing = await run([
      "short",
      "render",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(missing.exitCode).toBe(2);

    expect((await jobs()).length).toBe(before);
  });
});
