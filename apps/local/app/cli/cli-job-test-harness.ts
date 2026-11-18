import { Effect, Layer } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import type { TestDb } from "@/test-utils/test-db";
import {
  buildWriteLayer,
  makeRun,
  type RunResult,
} from "./cli-write-test-harness";

/**
 * Shared by the `cvm job` and `cvm video post-youtube` suites: the REAL
 * buildProgram over the test database, with that database also provided as
 * the DrizzleService the local-only verbs open (`withSidecarDatabase`), and a
 * test that plays the Sidecar by hand — no Sidecar ever runs here, so no Job
 * is ever executed and nothing is uploaded.
 */
export const makeJobRun = (
  db: TestDb
): ((argv: ReadonlyArray<string>) => Promise<RunResult>) =>
  makeRun(
    Layer.mergeAll(
      buildWriteLayer(db),
      Layer.succeed(DrizzleService, db as never)
    ) as ReturnType<typeof buildWriteLayer>
  );

const jobOps = (db: TestDb) =>
  JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, db as never))
  );

/** Run `effect` against the test database's Job queue. */
export const withJobs = <A, E>(
  db: TestDb,
  effect: Effect.Effect<A, E, JobOperationsService>
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(jobOps(db))));

/** Queue a Job directly, as any enqueuer does. */
export const enqueueTestJob = (
  db: TestDb,
  input: {
    readonly kind: string;
    readonly subject?: { type: string; id: string } | null;
    readonly params?: Record<string, unknown>;
  }
) =>
  withJobs(
    db,
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.enqueueJob({
        id: null,
        kind: input.kind,
        title: input.kind,
        lane: "default",
        params: input.params ?? {},
        maxAttempts: 1,
        dependsOn: null,
        subject: input.subject ?? null,
      })
    )
  );

const HOLDER = "test-sidecar";

/**
 * Play the Sidecar: claim the next Job in the `default` lane (where the
 * posting kinds run), write `events`, then end it as `end` says.
 */
export const settleAsSidecar = (
  db: TestDb,
  end: "succeed" | "fail",
  events: ReadonlyArray<{ type: string; data: Record<string, unknown> }> = []
) =>
  withJobs(
    db,
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* ops.claimNextJob({
        lane: "default",
        holder: HOLDER,
        leaseMs: 30_000,
      });
      if (!job) return yield* Effect.dieMessage("nothing to claim");
      for (const event of events) {
        yield* ops.appendJobEvent({ jobId: job.id, ...event });
      }
      if (end === "succeed") {
        yield* ops.completeJob({ jobId: job.id, holder: HOLDER });
      } else {
        yield* ops.failJobAttempt({
          jobId: job.id,
          holder: HOLDER,
          failure: {
            tag: "YouTubeUploadError",
            message: "YouTube said 403 quotaExceeded",
            cause: "YouTubeUploadError: …",
          },
          interrupted: false,
          mayRetry: false,
        });
      }
      return job.id;
    })
  );

/** Wait (up to `ms`) until a Job is in the queue, then settle it. */
export const settleWhenQueued = async (
  db: TestDb,
  end: "succeed" | "fail",
  events: ReadonlyArray<{ type: string; data: Record<string, unknown> }> = [],
  ms = 10_000
): Promise<string> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const queued = await withJobs(
      db,
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.listJobs({ status: "queued", limit: 1 })
      )
    );
    if (queued.length > 0) return settleAsSidecar(db, end, events);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("no Job was queued");
};
