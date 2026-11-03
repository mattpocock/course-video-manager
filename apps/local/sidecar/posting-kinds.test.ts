import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Data, Deferred, Effect, Fiber, Layer, Logger, Schema } from "effect";
import {
  JobOperationsService,
  dependencyFailedMessage,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { jobs } from "@cvm/core/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { POSTING_JOB_KINDS } from "@/features/jobs/job-wire";
import {
  defineJobKind,
  definePostingJobKind,
  isPostingKind,
  type PostCheck,
} from "./job-kind";
import {
  enqueueJob,
  JOB_KINDS,
  retryJob,
  type JobKindRegistry,
} from "./job-kinds";
import { makeJsonLogger } from "./json-logger";
import {
  POSTING_JOB_POLICY,
  POSTING_KIND_NAMES,
  UPLOAD_MANAGER_POLICIES,
} from "./retry-policy";
import { POST_CHECK_EVENT, runSidecar, type SidecarTiming } from "./sidecar";
import { noopJobKind } from "./kinds/noop";

/**
 * THE POSTING GUARD (decision 5 in docs/plans/background-jobs-sidecar.md).
 * Matt: "I definitely don't want reruns to happen on their own. Posting
 * twice would be disastrous." Every posting kind runs exactly once:
 *
 * - 1 attempt, and no automatic retry when it fails;
 * - no re-queue after a deliberate stop, nor after a crash — it ends
 *   `interrupted` ("check before retrying"), and the sidecar looks at the
 *   service to say whether it went out;
 * - only the author's Retry runs it again, once.
 *
 * The browser used to retry a failed post up to 3 times; that is removed on
 * purpose. If this file fails, a post can run twice. Do not loosen it.
 */

describe("the posting kinds' policy", () => {
  it("every Upload Manager posting type is a posting kind in the registry: 1 attempt, never re-queued", () => {
    for (const name of POSTING_KIND_NAMES) {
      const kind = Object.hasOwn(JOB_KINDS, name)
        ? JOB_KINDS[name as keyof typeof JOB_KINDS]
        : undefined;
      expect({ name, registered: kind !== undefined }).toEqual({
        name,
        registered: true,
      });
      if (!kind) continue;
      expect({ name, posting: isPostingKind(kind) }).toEqual({
        name,
        posting: true,
      });
      expect({ name, maxAttempts: kind.maxAttempts }).toEqual({
        name,
        maxAttempts: 1,
      });
    }
  });

  it("no kind in the registry that posts allows more than 1 attempt", () => {
    for (const [name, kind] of Object.entries(JOB_KINDS)) {
      if (isPostingKind(kind)) {
        expect({ name, maxAttempts: kind.maxAttempts }).toEqual({
          name,
          maxAttempts: 1,
        });
      }
    }
  });

  it("the Upload Manager's policy table gives every posting type the posting policy", () => {
    for (const name of POSTING_KIND_NAMES) {
      expect(UPLOAD_MANAGER_POLICIES[name]).toBe(POSTING_JOB_POLICY);
    }
    expect(POSTING_JOB_POLICY).toEqual({
      lane: "default",
      maxAttempts: 1,
      posting: true,
    });
  });

  it("the browser's list of posting kinds is the sidecar's", () => {
    expect([...POSTING_JOB_KINDS].sort()).toEqual(
      [...POSTING_KIND_NAMES].sort()
    );
  });

  it("the type system refuses a posting kind with attempts, or a retrying kind that posts", () => {
    definePostingJobKind({
      // @ts-expect-error a posting kind's policy is fixed: no attempts to set
      maxAttempts: 3,
      params: Schema.Struct({}),
      run: () => Effect.void,
      checkPosted: () => Effect.succeed(UNKNOWN),
    });
    defineJobKind({
      lane: "default",
      maxAttempts: 3,
      // @ts-expect-error a kind that posts is defined with definePostingJobKind
      posting: true,
      params: Schema.Struct({}),
      run: () => Effect.void,
    });
    // A posting kind must say how to look for a post that was cut off.
    // @ts-expect-error checkPosted is required
    definePostingJobKind({ params: Schema.Struct({}), run: () => Effect.void });
  });
});

class StubPostError extends Data.TaggedError("StubPostError")<{
  readonly message: string;
}> {}

const UNKNOWN: PostCheck = { verdict: "unknown", detail: "test", url: null };

// -- A real sidecar, on PGlite ------------------------------------------------

let testDb: TestDb;
let dir: string;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-posting-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const layer = () =>
  Layer.mergeAll(
    JobOperationsService.Default.pipe(
      Layer.provide(Layer.succeed(DrizzleService, testDb as any))
    ),
    Logger.replace(
      Logger.defaultLogger,
      makeJsonLogger({ logDir: dir, write: () => {} })
    )
  );

const TIMING: SidecarTiming = {
  leaseMs: 2_000,
  leaseRenewMs: 500,
  jobLeaseMs: 2_000,
  jobHeartbeatMs: 500,
  pollMs: 50,
  recoverEveryMs: 1_000,
  lapseWaitMs: 200,
  postCheckTimeoutMs: 1_000,
};

const startSidecar = (
  registry: JobKindRegistry<never>,
  name: string,
  timing: SidecarTiming = TIMING
) =>
  Effect.gen(function* () {
    const stop = yield* Deferred.make<string>();
    const serving = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      runSidecar({
        identity: {
          holder: `${name}-holder`,
          pid: process.pid,
          hostname: "test",
          checkout: `/checkouts/${name}`,
          gitSha: "abc1234",
          socket: path.join(dir, `${name}.sock`),
        },
        registry,
        timing,
        stop,
        serve: () => Deferred.succeed(serving, undefined),
      })
    );
    yield* Deferred.await(serving);
    const stopIt = Deferred.succeed(stop, "SIGTERM").pipe(
      Effect.zipRight(Fiber.join(fiber))
    );
    return { stop: stopIt };
  });

const waitForJob = (id: string, done: (job: Job) => boolean) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    for (let i = 0; i < 200; i++) {
      const job = yield* ops.getJob(id);
      if (job && done(job)) return job;
      yield* Effect.sleep(25);
    }
    return yield* Effect.dieMessage(`job ${id} never got there`);
  });

const eventTypes = (id: string) =>
  JobOperationsService.pipe(
    Effect.flatMap((ops) => ops.listJobEvents(id)),
    Effect.map((events) => events.map((e) => e.type))
  );

/**
 * A stub post: counts every run (the "request log"), hangs or fails as
 * asked, and answers a post-check with what it counted.
 */
const stubPost = () => {
  const runs: string[] = [];
  const checks: string[] = [];
  const kind = definePostingJobKind({
    params: Schema.Struct({
      outcome: Schema.Literal("hang", "fail", "succeed"),
    }),
    run: (params, ctx) =>
      Effect.gen(function* () {
        runs.push(ctx.jobId);
        if (params.outcome === "hang") return yield* Effect.never;
        if (params.outcome === "fail") {
          return yield* new StubPostError({ message: "the service said no" });
        }
      }),
    checkPosted: (_params, post) =>
      Effect.sync(() => {
        checks.push(post.id);
        return {
          verdict: "not-posted",
          detail: "the stub has no such post",
          url: null,
        } satisfies PostCheck;
      }),
  });
  return {
    registry: { post: kind, noop: noopJobKind },
    runs: (id: string) => runs.filter((r) => r === id).length,
    checks: (id: string) => checks.filter((c) => c === id).length,
  };
};

const enqueuePost = (
  registry: JobKindRegistry<never>,
  outcome: "hang" | "fail" | "succeed",
  dependsOn: string | null = null
) =>
  enqueueJob({
    id: null,
    kind: "post",
    title: "a post",
    params: { outcome },
    dependsOn,
    subject: null,
    attemptsSpent: 0,
    registry,
  });

describe("a posting Job in the sidecar", () => {
  it.live(
    "is enqueued with exactly 1 attempt, and never with an attempt already spent",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        const job = yield* enqueuePost(stub.registry, "succeed");
        expect(job.maxAttempts).toBe(1);
        const refused = yield* enqueueJob({
          id: null,
          kind: "post",
          title: "a post",
          params: { outcome: "succeed" },
          dependsOn: null,
          subject: null,
          attemptsSpent: 1,
          registry: stub.registry,
        }).pipe(Effect.flip);
        expect(refused._tag).toBe("NoAttemptsLeftError");
      }).pipe(Effect.provide(layer()))
  );

  it.live("that fails is not retried: failed after 1 run", () =>
    Effect.gen(function* () {
      const stub = stubPost();
      const sidecar = yield* startSidecar(stub.registry, "a");
      const job = yield* enqueuePost(stub.registry, "fail");
      const done = yield* waitForJob(job.id, (j) => j.status === "failed");
      yield* Effect.sleep(300);
      expect(done).toMatchObject({ attempt: 1, maxAttempts: 1 });
      expect(stub.runs(job.id)).toBe(1);
      yield* sidecar.stop;
    }).pipe(Effect.provide(layer()))
  );

  it.live(
    "cut off by a deliberate stop is NOT put back: interrupted, never re-run by the next sidecar, and looked for",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        const first = yield* startSidecar(stub.registry, "a");
        const job = yield* enqueuePost(stub.registry, "hang");
        yield* waitForJob(job.id, (j) => j.status === "running");
        yield* first.stop;

        const ops = yield* JobOperationsService;
        expect(yield* ops.getJob(job.id)).toMatchObject({
          status: "interrupted",
          attempt: 1,
          error: { tag: "JobInterrupted" },
        });
        expect(yield* eventTypes(job.id)).not.toContain("requeued");

        // The next sidecar does not run it; it looks for it at the service.
        const second = yield* startSidecar(stub.registry, "b");
        yield* Effect.sleep(500);
        expect(stub.runs(job.id)).toBe(1);
        expect(stub.checks(job.id)).toBe(1);
        expect(yield* eventTypes(job.id)).toContain(POST_CHECK_EVENT);
        expect(yield* ops.getJob(job.id)).toMatchObject({
          status: "interrupted",
        });
        yield* second.stop;
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "left running by a sidecar that died is NOT re-run: recovery ends it interrupted, and it is looked for once",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        const ops = yield* JobOperationsService;
        const job = yield* enqueuePost(stub.registry, "succeed");
        // A dead sidecar's claim, its lease already lapsed.
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);

        const sidecar = yield* startSidecar(stub.registry, "a");
        yield* waitForJob(job.id, (j) => j.status === "interrupted");
        yield* Effect.sleep(1_500); // past a second recovery sweep
        expect(stub.runs(job.id)).toBe(0);
        expect(stub.checks(job.id)).toBe(1);
        yield* sidecar.stop;
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "still running when a late heartbeat lets its lease lapse, is not recovered by its own sidecar: no Retry can run it beside itself",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        // Heartbeats far apart, recovery often: the lease lapses mid-post.
        const sidecar = yield* startSidecar(stub.registry, "a", {
          ...TIMING,
          jobHeartbeatMs: 60_000,
          recoverEveryMs: 100,
        });
        const job = yield* enqueuePost(stub.registry, "hang");
        yield* waitForJob(job.id, (j) => j.status === "running");
        yield* Effect.promise(() =>
          testDb
            .update(jobs)
            .set({ leaseUntil: sql`now() - interval '1 second'` })
            .where(eq(jobs.id, job.id))
        );
        yield* Effect.sleep(500); // several recovery sweeps

        const ops = yield* JobOperationsService;
        expect(yield* ops.getJob(job.id)).toMatchObject({ status: "running" });
        const retry = yield* retryJob({
          jobId: job.id,
          attempt: 1,
          registry: stub.registry,
        }).pipe(Effect.flip);
        expect(retry._tag).toBe("JobNotRetryableError");
        expect(stub.runs(job.id)).toBe(1);
        yield* sidecar.stop;
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "is never retried on its own even if its row claims more attempts",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        const ops = yield* JobOperationsService;
        // Rows written behind the registry's back, with 3 attempts. The
        // first is claimed by a sidecar that then dies.
        const crashed = yield* ops.enqueueJob({
          id: null,
          kind: "post",
          title: "forged, crashed",
          lane: "default",
          params: { outcome: "succeed" },
          maxAttempts: 3,
          dependsOn: null,
          subject: null,
        });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);
        const failing = yield* ops.enqueueJob({
          id: null,
          kind: "post",
          title: "forged",
          lane: "default",
          params: { outcome: "fail" },
          maxAttempts: 3,
          dependsOn: null,
          subject: null,
        });

        const sidecar = yield* startSidecar(stub.registry, "a");
        yield* waitForJob(failing.id, (j) => j.status === "failed");
        yield* waitForJob(crashed.id, (j) => j.status === "interrupted");
        yield* Effect.sleep(300);
        expect(stub.runs(failing.id)).toBe(1);
        expect(stub.runs(crashed.id)).toBe(0);
        yield* sidecar.stop;
      }).pipe(Effect.provide(layer()))
  );

  it.live("runs once more, and only once, on the author's Retry", () =>
    Effect.gen(function* () {
      const stub = stubPost();
      const sidecar = yield* startSidecar(stub.registry, "a");
      const job = yield* enqueuePost(stub.registry, "fail");
      yield* waitForJob(job.id, (j) => j.status === "failed");

      const retried = yield* retryJob({
        jobId: job.id,
        attempt: 1,
        registry: stub.registry,
      });
      expect(retried).toMatchObject({ attempt: 2, maxAttempts: 2 });
      const done = yield* waitForJob(
        job.id,
        (j) => j.status === "failed" && j.attempt === 2
      );
      yield* Effect.sleep(300);
      expect(done.maxAttempts).toBe(2);
      expect(stub.runs(job.id)).toBe(2);
      yield* sidecar.stop;
    }).pipe(Effect.provide(layer()))
  );

  it.live(
    "is refused a Retry while it is not finished, and Retry is not for kinds that retry on their own",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        const job = yield* enqueuePost(stub.registry, "succeed");
        const early = yield* retryJob({
          jobId: job.id,
          attempt: 1,
          registry: stub.registry,
        }).pipe(Effect.flip);
        expect(early._tag).toBe("JobNotRetryableError");

        const noop = yield* enqueueJob({
          id: null,
          kind: "noop",
          title: "noop",
          params: {},
          dependsOn: null,
          subject: null,
          attemptsSpent: 0,
          registry: stub.registry,
        });
        const refused = yield* retryJob({
          jobId: noop.id,
          attempt: 1,
          registry: stub.registry,
        }).pipe(Effect.flip);
        expect(refused._tag).toBe("JobNotRetryableError");
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "waiting on a dependency that fails, fails with it and never runs",
    () =>
      Effect.gen(function* () {
        const stub = stubPost();
        const sidecar = yield* startSidecar(stub.registry, "a");
        const parent = yield* enqueueJob({
          id: null,
          kind: "noop",
          title: "the export",
          params: { failAttempts: 99 },
          dependsOn: null,
          subject: null,
          attemptsSpent: 0,
          registry: stub.registry,
        });
        const job = yield* enqueuePost(stub.registry, "succeed", parent.id);
        const done = yield* waitForJob(job.id, (j) => j.status === "failed");
        expect(done.error).toMatchObject({
          message: dependencyFailedMessage("the export"),
        });
        expect(stub.runs(job.id)).toBe(0);
        yield* sidecar.stop;
      }).pipe(Effect.provide(layer()))
  );
});
