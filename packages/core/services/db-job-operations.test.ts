import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { eq, inArray, sql } from "drizzle-orm";
import { jobs, recordingSessions } from "../db/schema.js";
import {
  JobOperationsService,
  INTERRUPTED_POST_MESSAGE,
  dependencyFailedMessage,
  POSTED_EVENT,
  POST_CHECK_EVENT,
} from "./db-job-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

let testDb: TestDb;
let testLayer: Layer.Layer<JobOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const LEASE = 30_000;

const enqueue = (
  overrides: Partial<{
    kind: string;
    title: string;
    lane: string;
    maxAttempts: number;
    dependsOn: string | null;
  }> = {}
) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.enqueueJob({
      id: null,
      kind: overrides.kind ?? "noop",
      title: overrides.title ?? "A job",
      lane: overrides.lane ?? "default",
      params: {},
      maxAttempts: overrides.maxAttempts ?? 3,
      dependsOn: overrides.dependsOn ?? null,
      subject: null,
    })
  );

const failure = { tag: "Boom", message: "boom", cause: "Boom: boom" };

const lapse = Effect.promise(() => new Promise((r) => setTimeout(r, 5)));

describe("claimNextJob", () => {
  it.effect(
    "hands each queued Job in a lane to exactly one claimer, oldest first",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const first = yield* enqueue({ title: "first" });
        const second = yield* enqueue({ title: "second" });
        yield* enqueue({ title: "elsewhere", lane: "publish" });

        const a = yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        });
        const b = yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        });
        const c = yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        });

        expect([a?.id, b?.id, c]).toEqual([first.id, second.id, undefined]);
        expect(a?.status).toBe("running");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("holds a Job back until the Job it depends on has succeeded", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const parent = yield* enqueue({ title: "upload" });
      const child = yield* enqueue({ title: "post", dependsOn: parent.id });

      const claimed = yield* ops.claimNextJob({
        lane: "default",
        holder: "h",
        leaseMs: LEASE,
      });
      expect(claimed?.id).toBe(parent.id);
      expect(
        yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        })
      ).toBeUndefined();

      yield* ops.completeJob({ jobId: parent.id, holder: "h" });
      const next = yield* ops.claimNextJob({
        lane: "default",
        holder: "h",
        leaseMs: LEASE,
      });
      expect(next?.id).toBe(child.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "holds Footage transcription, queued, while a Recording Session records, and runs everything else, Clip transcription too",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const claim = () =>
          ops.claimNextJob({ lane: "default", holder: "h", leaseMs: LEASE });
        const transcribe = yield* enqueue({ kind: "transcribe-footage" });
        // A Clip is transcribed as it arrives, mid-take (#2224).
        const clips = yield* enqueue({ kind: "transcribe-clips" });
        const other = yield* enqueue({ kind: "noop" });
        yield* Effect.promise(() =>
          testDb.insert(recordingSessions).values({
            id: "rs-1",
            cameraFilePath: "camera.mkv",
            screenFilePath: "screen.mkv",
            micFilePath: "mic.mkv",
          })
        );
        // A take left "recording" for days (never recovered) holds nothing.
        yield* Effect.promise(() =>
          testDb.insert(recordingSessions).values({
            id: "rs-stale",
            cameraFilePath: "camera.mkv",
            screenFilePath: "screen.mkv",
            micFilePath: "mic.mkv",
            startedAt: new Date(Date.now() - 3 * 24 * 3600_000),
          })
        );

        expect((yield* claim())?.id).toBe(clips.id);
        expect((yield* claim())?.id).toBe(other.id);
        expect(yield* claim()).toBeUndefined();

        yield* Effect.promise(() =>
          testDb
            .update(recordingSessions)
            .set({ status: "stopped" })
            .where(eq(recordingSessions.id, "rs-1"))
        );
        expect((yield* claim())?.id).toBe(transcribe.id);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "fails a Job at once, naming its dependency, when that one has already failed for good",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        // "Export + post": the export fails before the post's enqueue lands.
        const parent = yield* enqueue({ title: "the export", maxAttempts: 1 });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        });
        yield* ops.failJobAttempt({
          jobId: parent.id,
          holder: "h",
          failure,
          interrupted: false,
          mayRetry: true,
        });

        const child = yield* enqueue({ title: "post", dependsOn: parent.id });
        expect(child).toMatchObject({
          status: "failed",
          error: { message: dependencyFailedMessage("the export") },
        });
        expect((yield* ops.listJobEvents(child.id)).map((e) => e.type)).toEqual(
          ["queued", "failed"]
        );
      }).pipe(Effect.provide(testLayer))
  );
});

describe("failJobAttempt", () => {
  it.effect(
    "re-queues a failed attempt until max_attempts, then fails the Job and everything queued behind it",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const parent = yield* enqueue({ title: "upload", maxAttempts: 3 });
        const child = yield* enqueue({ title: "post", dependsOn: parent.id });
        const grandchild = yield* enqueue({
          title: "share",
          dependsOn: child.id,
        });

        const outcomes: string[] = [];
        for (let i = 0; i < 3; i++) {
          yield* ops.claimNextJob({
            lane: "default",
            holder: "h",
            leaseMs: LEASE,
          });
          outcomes.push(
            yield* ops.failJobAttempt({
              jobId: parent.id,
              holder: "h",
              failure,
              interrupted: false,
              mayRetry: true,
            })
          );
        }

        expect(outcomes).toEqual(["retrying", "retrying", "failed"]);
        const after = yield* ops.getJob(parent.id);
        expect(after).toMatchObject({
          status: "failed",
          attempt: 3,
          error: failure,
        });
        expect((yield* ops.getJob(child.id))?.error).toMatchObject({
          message: 'Dependency "upload" failed',
        });
        expect((yield* ops.getJob(grandchild.id))?.error).toMatchObject({
          message: 'Dependency "post" failed',
        });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses to settle a Job its holder no longer holds", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* enqueue();
      yield* ops.claimNextJob({
        lane: "default",
        holder: "old",
        leaseMs: LEASE,
      });

      expect(
        yield* ops.failJobAttempt({
          jobId: job.id,
          holder: "new",
          failure,
          interrupted: false,
          mayRetry: true,
        })
      ).toBe("not-held");
      expect(yield* ops.completeJob({ jobId: job.id, holder: "new" })).toBe(
        false
      );
      expect((yield* ops.getJob(job.id))?.status).toBe("running");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("recoverExpiredJobs", () => {
  it.effect(
    "re-queues a Job whose sidecar died while it has attempts left, and leaves it interrupted on its last",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const retryable = yield* enqueue({ title: "export", maxAttempts: 3 });
        const once = yield* enqueue({
          title: "publish",
          maxAttempts: 1,
          lane: "publish",
        });
        const alive = yield* enqueue({ title: "still running" });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* ops.claimNextJob({
          lane: "publish",
          holder: "dead",
          leaseMs: 1,
        });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "live",
          leaseMs: LEASE,
        });
        yield* lapse;

        const recovered = yield* ops.recoverExpiredJobs({
          neverRetryKinds: {},
          stillRunning: [],
        });

        expect(
          Object.fromEntries(recovered.map((r) => [r.jobId, r.outcome]))
        ).toEqual({
          [retryable.id]: "retrying",
          [once.id]: "interrupted",
        });
        expect(yield* ops.getJob(retryable.id)).toMatchObject({
          status: "queued",
          attempt: 2,
        });
        expect((yield* ops.getJob(alive.id))?.status).toBe("running");
        const events = (yield* ops.listJobEvents(once.id)).map((e) => e.type);
        expect(events).toEqual(["queued", "started", "interrupted"]);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("a kind that must never run again on its own (a post)", () => {
  it.effect(
    "recovery ends each never-retry kind with that kind's own words",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const post = yield* enqueue({ kind: "post", title: "a post" });
        const publish = yield* enqueue({ kind: "publish", title: "a Publish" });
        for (const holder of ["dead-1", "dead-2"]) {
          yield* ops.claimNextJob({ lane: "default", holder, leaseMs: 1 });
        }
        yield* lapse;
        yield* ops.recoverExpiredJobs({
          neverRetryKinds: {
            post: "the post may have gone out",
            publish: "Promote or Discard it on the publish page",
          },
          stillRunning: [],
        });
        expect(yield* ops.getJob(post.id)).toMatchObject({
          status: "interrupted",
          error: { message: "the post may have gone out" },
        });
        expect(yield* ops.getJob(publish.id)).toMatchObject({
          status: "interrupted",
          error: { message: "Promote or Discard it on the publish page" },
        });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "ends a failed attempt for good, and recovery ends a lost one interrupted, whatever the row's attempts say",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const failed = yield* enqueue({ title: "post", maxAttempts: 3 });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        });
        expect(
          yield* ops.failJobAttempt({
            jobId: failed.id,
            holder: "h",
            failure,
            interrupted: false,
            mayRetry: false,
          })
        ).toBe("failed");

        const lost = yield* enqueue({ title: "lost post", maxAttempts: 3 });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* lapse;
        const recovered = yield* ops.recoverExpiredJobs({
          neverRetryKinds: { noop: INTERRUPTED_POST_MESSAGE },
          stillRunning: [],
        });
        expect(recovered).toEqual([{ jobId: lost.id, outcome: "interrupted" }]);
        expect(yield* ops.getJob(lost.id)).toMatchObject({
          status: "interrupted",
          attempt: 1,
        });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "the author's Retry runs it once more: the same row, its next attempt, and that attempt its last",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const job = yield* enqueue({ title: "post", maxAttempts: 1 });
        expect(
          (yield* ops.retryJob({ jobId: job.id, attempt: 1 })).outcome
        ).toBe("not-retryable");
        yield* ops.claimNextJob({
          lane: "default",
          holder: "h",
          leaseMs: LEASE,
        });
        yield* ops.failJobAttempt({
          jobId: job.id,
          holder: "h",
          failure,
          interrupted: true,
          mayRetry: false,
        });

        const retried = yield* ops.retryJob({ jobId: job.id, attempt: 1 });
        expect(retried).toMatchObject({
          outcome: "queued",
          job: { status: "queued", attempt: 2, maxAttempts: 2 },
        });
        const events = yield* ops.listJobEvents(job.id);
        expect(events.at(-1)).toMatchObject({
          type: "queued",
          data: { attempt: 2, retriedBy: "author" },
        });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "refuses a Retry of any run but the latest, and of a run that went out",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const settleRun = (job: { id: string }, posted: boolean) =>
          Effect.gen(function* () {
            yield* ops.claimNextJob({
              lane: "default",
              holder: "h",
              leaseMs: LEASE,
            });
            if (posted) {
              yield* ops.appendJobEvent({
                jobId: job.id,
                type: POSTED_EVENT,
                data: { url: "https://example.test/1" },
              });
            }
            yield* ops.failJobAttempt({
              jobId: job.id,
              holder: "h",
              failure,
              interrupted: false,
              mayRetry: false,
            });
          });

        // The same Retry sent twice, the run failing in between.
        const twice = yield* enqueue({ title: "post", maxAttempts: 1 });
        yield* settleRun(twice, false);
        expect(
          (yield* ops.retryJob({ jobId: twice.id, attempt: 1 })).outcome
        ).toBe("queued");
        yield* settleRun(twice, false);
        expect(
          (yield* ops.retryJob({ jobId: twice.id, attempt: 1 })).outcome
        ).toBe("stale");

        // It went out, then failed (a thumbnail): never again.
        const posted = yield* enqueue({ title: "posted", maxAttempts: 1 });
        yield* settleRun(posted, true);
        expect(
          (yield* ops.retryJob({ jobId: posted.id, attempt: 1 })).outcome
        ).toBe("went-out");

        // Its post-check found it at the service.
        const found = yield* enqueue({ title: "found", maxAttempts: 1 });
        yield* settleRun(found, false);
        yield* ops.appendJobEvent({
          jobId: found.id,
          type: POST_CHECK_EVENT,
          data: { verdict: "posted", detail: "", url: null, attempt: 1 },
        });
        expect(
          (yield* ops.retryJob({ jobId: found.id, attempt: 1 })).outcome
        ).toBe("went-out");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "lists the interrupted posts nobody has looked for yet, and stops once one has been",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const job = yield* enqueue({ title: "post", maxAttempts: 1 });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* lapse;
        yield* ops.recoverExpiredJobs({
          neverRetryKinds: { noop: INTERRUPTED_POST_MESSAGE },
          stillRunning: [],
        });
        const look = () =>
          ops.listInterruptedJobsWithoutEvent({
            kinds: ["noop"],
            eventType: "post-check",
            finishedWithinMs: 60_000,
          });
        expect((yield* look()).map((j) => j.id)).toEqual([job.id]);
        yield* ops.appendJobEvent({
          jobId: job.id,
          type: "post-check",
          data: { verdict: "unknown" },
        });
        expect(yield* look()).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("listRecentJobs", () => {
  it.effect(
    "gives a new subscriber every unfinished Job and the recently finished ones, each with its events",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const waiting = yield* enqueue({ title: "waiting" });
        const done = yield* enqueue({ title: "done", lane: "publish" });
        yield* ops.claimNextJob({
          lane: "publish",
          holder: "h",
          leaseMs: LEASE,
        });
        yield* ops.completeJob({ jobId: done.id, holder: "h" });

        const recent = yield* ops.listRecentJobs({ finishedWithinMs: 60_000 });
        expect(
          recent.map((r) => [r.job.title, r.events.map((e) => e.type)])
        ).toEqual([
          ["waiting", ["queued"]],
          ["done", ["queued", "started", "succeeded"]],
        ]);

        yield* lapse;
        const later = yield* ops.listRecentJobs({ finishedWithinMs: 1 });
        expect(later.map((r) => r.job.id)).toEqual([waiting.id]);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("the snapshot filter", () => {
  it.effect(
    "leaves out a dismissed Job and one that succeeded over a day ago, keeps a failed one however old, and never dismisses a running one",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const settle = (title: string, outcome: "succeeded" | "failed") =>
          Effect.gen(function* () {
            const job = yield* enqueue({ title, lane: title });
            yield* ops.claimNextJob({
              lane: title,
              holder: "h",
              leaseMs: LEASE,
            });
            if (outcome === "succeeded") {
              yield* ops.completeJob({ jobId: job.id, holder: "h" });
            } else {
              yield* ops.failJobAttempt({
                jobId: job.id,
                holder: "h",
                failure,
                interrupted: false,
                mayRetry: false,
              });
            }
            return job;
          });
        yield* settle("fresh", "succeeded");
        const dismissed = yield* settle("dismissed", "succeeded");
        const stale = yield* settle("stale", "succeeded");
        const failedLongAgo = yield* settle("failed long ago", "failed");
        const running = yield* enqueue({ title: "running", lane: "running" });
        yield* ops.claimNextJob({
          lane: "running",
          holder: "h",
          leaseMs: LEASE,
        });
        yield* Effect.promise(() =>
          testDb
            .update(jobs)
            .set({ finishedAt: sql`now() - interval '25 hours'` })
            .where(inArray(jobs.id, [stale.id, failedLongAgo.id]))
        );

        const done = yield* ops.dismissJobs({
          jobIds: [dismissed.id, running.id, "no-such-job"],
        });
        expect(done).toEqual([dismissed.id]);
        // Dismissing twice records nothing new.
        expect(yield* ops.dismissJobs({ jobIds: [dismissed.id] })).toEqual([]);

        const snapshot = yield* ops.listRecentJobs({
          finishedWithinMs: 24 * 60 * 60_000,
        });
        expect(snapshot.map((r) => r.job.title)).toEqual([
          "fresh",
          "failed long ago",
          "running",
        ]);
        expect((yield* ops.getJob(running.id))?.status).toBe("running");

        yield* ops.dismissJobs({ jobIds: [failedLongAgo.id] });
        const after = yield* ops.listRecentJobs({
          finishedWithinMs: 24 * 60 * 60_000,
        });
        expect(after.map((r) => r.job.title)).toEqual(["fresh", "running"]);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("the sidecar lease", () => {
  const take = (holder: string, leaseMs: number) =>
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.acquireSidecarLease({
        holder,
        pid: 1,
        hostname: "box",
        checkout: `/repo/${holder}`,
        gitSha: "abc",
        socket: "/tmp/s.sock",
        leaseMs,
      })
    );

  it.effect(
    "goes to one sidecar at a time, and to the next once it lapses",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        expect((yield* take("first", 1)).acquired).toBe(true);
        expect((yield* take("first", LEASE)).acquired).toBe(true);

        const refused = yield* take("second", LEASE);
        expect(refused).toMatchObject({
          acquired: false,
          lease: { holder: "first", checkout: "/repo/first" },
        });

        yield* ops.releaseSidecarLease("first");
        yield* lapse;
        expect((yield* take("second", LEASE)).acquired).toBe(true);
        expect(
          yield* ops.renewSidecarLease({ holder: "first", leaseMs: LEASE })
        ).toBe(false);
      }).pipe(Effect.provide(testLayer))
  );
});
