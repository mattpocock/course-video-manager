import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { enqueueJob, JOB_KIND_SPECS } from "./job-specs";

let testDb: TestDb;
let jobOps: Layer.Layer<JobOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  jobOps = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, DrizzleService.make(testDb)))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(effect: Effect.Effect<A, E, JobOperationsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(jobOps)));

const exportVideo = (videoId: string) =>
  enqueueJob({
    id: crypto.randomUUID(),
    kind: "export",
    title: "Export",
    params: { videoId },
    dependsOn: null,
    subject: { type: "video", id: videoId },
    attemptsSpent: 0,
    registry: JOB_KIND_SPECS,
  });

const claim = () =>
  run(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.claimNextJob({ lane: "default", holder: "s1", leaseMs: 60_000 })
    )
  );

const jobCount = async () => (await testDb.query.jobs.findMany()).length;

describe("enqueueing an export Job", () => {
  it("answers a second Export of the same Video with the queued one", async () => {
    const first = await run(exportVideo("v1"));
    const second = await run(exportVideo("v1"));

    expect(second.id).toBe(first.id);
    expect(await jobCount()).toBe(1);
  });

  it("answers with the running Export", async () => {
    const first = await run(exportVideo("v1"));
    await claim();

    const second = await run(exportVideo("v1"));

    expect(second.id).toBe(first.id);
  });

  it("adds one for a different Video", async () => {
    const first = await run(exportVideo("v1"));
    const other = await run(exportVideo("v2"));

    expect(other.id).not.toBe(first.id);
    expect(await jobCount()).toBe(2);
  });
});
