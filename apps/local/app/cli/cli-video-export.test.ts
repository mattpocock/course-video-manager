import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger, LogLevel } from "effect";
import { NodeContext } from "@effect/platform-node";
import { fromPartial } from "@total-typescript/shoehorn";
import os from "node:os";
import nodePath from "node:path";
import { createTestDb, type TestDb } from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { CoursePublishService } from "@/services/course-publish-service";
import { ExportError } from "@/services/course-publish-errors";
import { SidecarContextTest } from "@/services/sidecar-context";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { buildProgram } from "@/cli/main";
import { makeTestCliOutput } from "@/cli/output";
import { runSidecar } from "../../sidecar/sidecar";
import { exportJobKind } from "../../sidecar/kinds/export";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import { buildWriteLayer, one, type RunResult } from "./cli-write-test-harness";

type ExportOutcome = "exported" | "fails" | "hangs";

let outcome: ExportOutcome = "exported";
let release: Deferred.Deferred<void> | null = null;
const exported: string[] = [];

const fakePublish = Layer.succeed(
  CoursePublishService,
  fromPartial<CoursePublishService>({
    exportVideo: (videoId: string) =>
      Effect.gen(function* () {
        exported.push(videoId);
        if (outcome === "fails") {
          return yield* new ExportError({
            message: "ffmpeg exited with code 1 while concatenating clips",
          });
        }
        if (outcome === "hangs" && release) {
          yield* Deferred.await(release);
        }
        return `/finished-videos/${videoId}.mp4`;
      }),
  })
);

const unusedVersions = Layer.succeed(
  VersionOperationsService,
  fromPartial<VersionOperationsService>({})
);

let testDb: TestDb;
let jobsLayer: Layer.Layer<JobOperationsService>;
let cliLayer: Layer.Layer<
  Layer.Layer.Success<ReturnType<typeof buildWriteLayer>> | JobOperationsService
>;
let stopSidecar: Deferred.Deferred<string>;
let sidecarFiber: Fiber.RuntimeFiber<unknown, unknown>;

const run = async (argv: ReadonlyArray<string>): Promise<RunResult> => {
  const out = makeTestCliOutput();
  const exitCode = await Effect.runPromise(
    buildProgram(argv).pipe(Effect.provide(Layer.merge(out.layer, cliLayer)))
  );
  return { stdout: out.stdout(), stderr: out.stderr(), exitCode };
};

const jobs = () =>
  Effect.runPromise(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.listRecentJobs({ finishedWithinMs: 3_600_000 })
    ).pipe(Effect.provide(jobsLayer))
  );

const getJob = (jobId: string) =>
  Effect.runPromise(
    Effect.flatMap(JobOperationsService, (ops) => ops.getJob(jobId)).pipe(
      Effect.provide(jobsLayer)
    )
  );

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  jobsLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, DrizzleService.make(testDb)))
  );
  cliLayer = Layer.merge(buildWriteLayer(testDb), jobsLayer);
  vi.stubEnv(LOCAL_MACHINE_ENV_KEY, "true");

  stopSidecar = Effect.runSync(Deferred.make<string>());
  sidecarFiber = Effect.runFork(
    runSidecar({
      identity: {
        holder: "video-export-test",
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/video-export",
        gitSha: "abc1234",
        socket: nodePath.join(os.tmpdir(), "cvm-video-export-test.sock"),
      },
      registry: { export: exportJobKind },
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
          fakePublish,
          unusedVersions,
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
  vi.unstubAllEnvs();
});

let videoId: string;

beforeEach(async () => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "export.mp4", originalFootagePath: "f.mp4" })
    .returning();
  if (!video) throw new Error("no Video inserted");
  videoId = video.id;
  outcome = "exported";
  release = null;
  exported.length = 0;
});

describe("video export", () => {
  it("runs the Export Job for the Video and prints the Exported Video's path", async () => {
    const r = await run(["video", "export", videoId]);

    expect(r.exitCode).toBe(0);
    const printed = one<{ jobId: string }>(r.stdout);
    expect(printed).toMatchObject({
      videoId,
      status: "succeeded",
      path: `/finished-videos/${videoId}.mp4`,
    });
    expect(await getJob(printed.jobId)).toMatchObject({
      kind: "export",
      status: "succeeded",
    });
    expect(exported).toEqual([videoId]);
  });

  it("--no-wait prints the queued Export Job, the Export button's, and returns", async () => {
    const r = await run(["video", "export", "--no-wait", videoId]);

    expect(r.exitCode).toBe(0);
    const queued = one<{ jobId: string; status: string; videoId: string }>(
      r.stdout
    );
    expect(queued).toMatchObject({ status: "queued", videoId });
    expect(await getJob(queued.jobId)).toMatchObject({
      kind: "export",
      params: { videoId },
      subjectType: "video",
      subjectId: videoId,
    });
  });

  it("prints the Export's own reason and exits non-zero when the Job fails", async () => {
    outcome = "fails";
    const r = await run(["video", "export", videoId]);

    expect(r.exitCode).toBe(4);
    expect(r.stdout).toBe("");
    expect(one(r.stderr.trim())).toMatchObject({
      _tag: "ExportError",
      message: "ffmpeg exited with code 1 while concatenating clips",
    });
  });

  it("gives up waiting at --timeout, and asking again joins the same Export", async () => {
    outcome = "hangs";
    const held = Effect.runSync(Deferred.make<void>());
    release = held;

    const first = await run(["video", "export", "--timeout", "1", videoId]);

    expect(first.exitCode).toBe(4);
    expect(first.stdout).toBe("");
    const timedOut = one<{ _tag: string; jobId: string }>(first.stderr.trim());
    expect(timedOut._tag).toBe("ExportWaitTimeoutError");

    const again = await run(["video", "export", "--no-wait", videoId]);
    await Effect.runPromise(Deferred.succeed(held, undefined));

    expect(again.exitCode).toBe(0);
    expect(one(again.stdout)).toMatchObject({
      jobId: timedOut.jobId,
      status: "running",
    });
    const settled = await run(["video", "export", videoId]);
    expect(one(settled.stdout)).toMatchObject({ status: "succeeded" });
    expect(exported[0]).toBe(videoId);
  });

  it("refuses an unknown Video (exit 2) and a --timeout under a second (exit 3), queueing no Job", async () => {
    const before = (await jobs()).length;

    const missing = await run([
      "video",
      "export",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(missing.exitCode).toBe(2);

    const zero = await run(["video", "export", "--timeout", "0", videoId]);
    expect(zero.exitCode).toBe(3);

    expect((await jobs()).length).toBe(before);
  });
});
