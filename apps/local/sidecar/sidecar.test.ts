import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { Deferred, Effect, Fiber, Layer, Logger, Schema } from "effect";
import { sql } from "drizzle-orm";
import { jobEvents, jobs } from "@cvm/core/db/schema";
import {
  JobOperationsService,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { defineJobKind } from "./job-kind";
import { enqueueJob, type JobKindRegistry } from "./job-kinds";
import { noopJobKind } from "./kinds/noop";
import { makeJsonLogger } from "./json-logger";
import { runSidecar, type SidecarTiming } from "./sidecar";
import { serveSidecarSocket } from "./socket";

/** The kinds that need no service: what these tests run. */
const JOB_KINDS = { noop: noopJobKind } as const;

let testDb: TestDb;
let dir: string;
let logDir: string;
let stdout: string[];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-sidecar-"));
  logDir = path.join(dir, "jobs");
  fs.mkdirSync(logDir);
  stdout = [];
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
      makeJsonLogger({ logDir, write: (text) => stdout.push(text) })
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

/** Start a sidecar in the background; resolves once its socket answers. */
const startSidecar = (
  registry: JobKindRegistry<never>,
  name = "first",
  timing: SidecarTiming = TIMING
) =>
  Effect.gen(function* () {
    const stop = yield* Deferred.make<string>();
    const socket = path.join(dir, `${name}.sock`);
    const serving = yield* Deferred.make<void>();
    const fiber = yield* Effect.fork(
      runSidecar({
        identity: {
          holder: `${name}-holder`,
          pid: process.pid,
          hostname: "test",
          checkout: `/checkouts/${name}`,
          gitSha: "abc1234",
          socket,
        },
        registry,
        timing,
        stop,
        serve: (handle) =>
          serveSidecarSocket({ socket, handle, registry, logDir }).pipe(
            Effect.zipRight(Deferred.succeed(serving, undefined))
          ),
      })
    );
    yield* Effect.raceFirst(
      Deferred.await(serving),
      Fiber.join(fiber).pipe(Effect.asVoid)
    );
    return { stop, fiber, socket };
  });

const request = (socket: string, method: string, url: string, body?: unknown) =>
  Effect.tryPromise(
    () =>
      new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = http.request(
          {
            socketPath: socket,
            method,
            path: url,
            headers: { "content-type": "application/json" },
          },
          (res) => {
            let text = "";
            res.on("data", (c) => (text += c));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) })
            );
          }
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      })
  );

const waitForJob = (id: string, done: (job: Job) => boolean) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    for (let i = 0; i < 200; i++) {
      const job = yield* ops.getJob(id);
      if (job && done(job)) return job;
      yield* Effect.sleep(25);
    }
    return yield* Effect.dieMessage(
      `job ${id} never reached the expected state`
    );
  });

const finished = (job: Job) => !["queued", "running"].includes(job.status);

const enqueue = (
  registry: JobKindRegistry<never>,
  kind: string,
  params: unknown,
  title = kind
) =>
  enqueueJob({
    id: null,
    kind,
    title,
    params,
    dependsOn: null,
    subject: null,
    attemptsSpent: 0,
    registry,
  });

const logLines = (jobId: string) =>
  fs
    .readFileSync(path.join(logDir, `${jobId}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

interface SseMessage {
  id: string | null;
  event: string;
  data: any;
}

/** Subscribe to the socket's `/events`; collects every message until closed. */
const subscribe = (socket: string, lastEventId: string | null = null) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const messages: SseMessage[] = [];
      let buffer = "";
      const req = http.get({
        socketPath: socket,
        path: "/events",
        headers: lastEventId ? { "last-event-id": lastEventId } : {},
      });
      req.on("response", (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const field = (name: string) =>
              block
                .split("\n")
                .find((l) => l.startsWith(`${name}: `))
                ?.slice(name.length + 2) ?? null;
            const event = field("event");
            const data = field("data");
            if (event && data) {
              messages.push({ id: field("id"), event, data: JSON.parse(data) });
            }
          }
        });
      });
      req.on("error", () => {});
      return { messages, req };
    }),
    ({ req }) => Effect.sync(() => req.destroy())
  ).pipe(
    Effect.map(({ messages }) => ({
      messages,
      waitFor: (done: (all: SseMessage[]) => boolean) =>
        Effect.gen(function* () {
          for (let i = 0; i < 200; i++) {
            if (done(messages)) return messages;
            yield* Effect.sleep(25);
          }
          return yield* Effect.dieMessage(
            `the stream never got there: ${JSON.stringify(messages.map((m) => m.event))}`
          );
        }),
    }))
  );

const eventTypes = (messages: SseMessage[], jobId: string) =>
  messages
    .filter((m) => m.event === "job-event" && m.data.job.id === jobId)
    .map((m) => m.data.event.type as string);

/** Kinds that record how many of themselves run at once. */
const concurrencyProbe = () => {
  let now = 0;
  let max = 0;
  const kind = (lane: "default" | "publish") =>
    defineJobKind({
      lane,
      maxAttempts: 1,
      params: Schema.Struct({}),
      run: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            now++;
            max = Math.max(max, now);
          }),
          () => Effect.sleep(150),
          () => Effect.sync(() => now--)
        ),
    });
  return {
    registry: {
      "probe-default": kind("default"),
      "probe-publish": kind("publish"),
    },
    max: () => max,
  };
};

describe("the sidecar", () => {
  it.live(
    "runs a Job enqueued over its socket, records its events, and logs it to the Job's own file",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);

        const health = yield* request(socket, "GET", "/health");
        expect(health.body).toMatchObject({
          ok: true,
          checkout: "/checkouts/first",
        });

        const enqueued = yield* request(socket, "POST", "/jobs", {
          kind: "noop",
          title: "a test job",
          params: { durationMs: 100 },
        });
        expect(enqueued.status).toBe(201);
        const id: string = enqueued.body.job.id;

        const job = yield* waitForJob(id, finished);
        expect(job.status).toBe("succeeded");
        const read = yield* request(socket, "GET", `/jobs/${id}`);
        const types: string[] = read.body.events.map(
          (e: { type: string }) => e.type
        );
        expect(types[0]).toBe("queued");
        expect(types).toContain("progress");
        expect(types.at(-1)).toBe("succeeded");

        const lines = logLines(id);
        expect(lines.map((l) => l.message)).toContain("job succeeded");
        expect(
          lines.every(
            (l) => l.jobId === id && l.kind === "noop" && l.attempt === 1
          )
        ).toBe(true);

        yield* Deferred.succeed(stop, "test over");
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Stopped",
          reason: "test over",
        });
        expect(fs.existsSync(socket)).toBe(false);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "refuses a Job of an unknown kind, or with bad params, at the socket",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);
        const unknown = yield* request(socket, "POST", "/jobs", {
          kind: "nope",
          title: "x",
        });
        const bad = yield* request(socket, "POST", "/jobs", {
          kind: "noop",
          title: "x",
          params: { durationMs: "soon" },
        });
        expect([unknown.status, bad.status]).toEqual([400, 400]);
        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "retries a failing Job at once until its attempts run out, and logs every failure with its cause",
    () =>
      Effect.gen(function* () {
        // Polling slower than the test waits: only the nudges can get it done.
        const { stop, fiber, socket } = yield* startSidecar(
          JOB_KINDS,
          "first",
          {
            ...TIMING,
            pollMs: 60_000,
          }
        );
        const enqueued = yield* request(socket, "POST", "/jobs", {
          kind: "noop",
          title: "fails",
          params: { failAttempts: 99 },
        });
        const job: Job = enqueued.body.job;

        const done = yield* waitForJob(job.id, finished);
        expect(done).toMatchObject({
          status: "failed",
          attempt: 3,
          error: { tag: "NoopJobFailedError" },
        });
        const failures = logLines(job.id).filter(
          (l) => l.message === "job failed"
        );
        expect(failures.map((l) => l.attempt)).toEqual([1, 2, 3]);
        expect(
          failures.every((l) => String(l.cause).includes("NoopJobFailedError"))
        ).toBe(true);

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live("logs a defect in a handler and fails the Job with it", () =>
    Effect.gen(function* () {
      const registry = {
        broken: defineJobKind({
          lane: "default",
          maxAttempts: 1,
          params: Schema.Struct({}),
          run: () => Effect.dieMessage("the renderer exploded"),
        }),
      };
      const { stop, fiber } = yield* startSidecar(registry);
      const job = yield* enqueue(registry, "broken", {});

      const done = yield* waitForJob(job.id, finished);
      expect((done.error as { message: string }).message).toBe(
        "the renderer exploded"
      );
      expect(
        logLines(job.id).some((l) =>
          String(l.cause).includes("the renderer exploded")
        )
      ).toBe(true);

      yield* Deferred.succeed(stop, "test over");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(layer()))
  );

  it.live(
    "runs one publish-lane Job at a time, and default-lane Jobs all at once",
    () =>
      Effect.gen(function* () {
        const publish = concurrencyProbe();
        const { stop, fiber } = yield* startSidecar(publish.registry);
        const publishes = yield* Effect.forEach([1, 2, 3], () =>
          enqueue(publish.registry, "probe-publish", {})
        );
        for (const p of publishes) yield* waitForJob(p.id, finished);
        expect(publish.max()).toBe(1);
        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);

        const unbounded = concurrencyProbe();
        const second = yield* startSidecar(unbounded.registry, "second");
        const defaults = yield* Effect.forEach([1, 2, 3], () =>
          enqueue(unbounded.registry, "probe-default", {})
        );
        for (const d of defaults) yield* waitForJob(d.id, finished);
        expect(unbounded.max()).toBe(3);
        yield* Deferred.succeed(second.stop, "test over");
        yield* Fiber.join(second.fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "puts a Job it was running back in the queue at the same attempt when it is stopped on purpose",
    () =>
      Effect.gen(function* () {
        const { stop, fiber } = yield* startSidecar(JOB_KINDS);
        const job = yield* enqueue(JOB_KINDS, "noop", { durationMs: 60_000 });
        yield* waitForJob(job.id, (j) => j.status === "running");

        yield* Deferred.succeed(stop, "SIGTERM");
        yield* Fiber.join(fiber);

        const ops = yield* JobOperationsService;
        // A restart (tsx watch after an edit, Ctrl-C) is not the Job failing.
        expect(yield* ops.getJob(job.id)).toMatchObject({
          status: "queued",
          attempt: 1,
        });
        const events = yield* ops.listJobEvents(job.id);
        expect(events.at(-1)).toMatchObject({
          type: "requeued",
          data: { attempt: 1 },
        });

        // The next sidecar runs it from where the queue left it.
        const next = yield* startSidecar(JOB_KINDS, "second");
        yield* waitForJob(job.id, (j) => j.status === "running");
        yield* Deferred.succeed(next.stop, "test over");
        yield* Fiber.join(next.fiber);
        expect(yield* ops.getJob(job.id)).toMatchObject({ attempt: 1 });
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "streams Job Events to a subscriber: a snapshot of what is running, then each event as it happens",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);
        const running = yield* enqueue(JOB_KINDS, "noop", {
          durationMs: 60_000,
        });
        yield* waitForJob(running.id, (j) => j.status === "running");

        const stream = yield* subscribe(socket);
        const [snapshot] = yield* stream.waitFor((all) => all.length > 0);
        expect(snapshot?.event).toBe("snapshot");
        expect(
          snapshot?.data.jobs.map((j: any) => [
            j.job.title,
            j.events.map((e: any) => e.type),
          ])
        ).toEqual([["noop", expect.arrayContaining(["queued", "started"])]]);

        const later = yield* enqueue(JOB_KINDS, "noop", {}, "later");
        yield* stream.waitFor((all) =>
          eventTypes(all, later.id).includes("succeeded")
        );
        expect(eventTypes(stream.messages, later.id)).toEqual([
          "queued",
          "started",
          "progress",
          "succeeded",
        ]);
        // Every live message carries its event's id, for a reconnect.
        const last = stream.messages.at(-1);
        expect(last?.id).toBe(String(last?.data.event.id));

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.scoped, Effect.provide(layer()))
  );

  it.live(
    "never streams yesterday's events to the morning's first subscriber",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);
        const old = yield* enqueue(JOB_KINDS, "noop", {}, "yesterday");
        yield* waitForJob(old.id, finished);
        // Everything about it happened two days ago.
        yield* Effect.promise(() =>
          testDb.execute(
            sql`UPDATE ${jobEvents} SET at = at - interval '2 days' WHERE ${jobEvents.jobId} = ${old.id}`
          )
        );
        yield* Effect.promise(() =>
          testDb.execute(
            sql`UPDATE ${jobs} SET finished_at = finished_at - interval '2 days' WHERE ${jobs.id} = ${old.id}`
          )
        );

        const stream = yield* subscribe(socket);
        const today = yield* enqueue(JOB_KINDS, "noop", {}, "today");
        yield* stream.waitFor((all) =>
          eventTypes(all, today.id).includes("succeeded")
        );
        const snapshot = stream.messages.find((m) => m.event === "snapshot");
        expect(snapshot?.data.jobs.map((j: any) => j.job.title)).not.toContain(
          "yesterday"
        );
        expect(eventTypes(stream.messages, old.id)).toEqual([]);

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.scoped, Effect.provide(layer()))
  );

  it.live(
    "replays what a subscriber missed after its Last-Event-ID instead of a snapshot",
    () =>
      Effect.gen(function* () {
        const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);
        const ops = yield* JobOperationsService;
        const before = yield* ops.latestJobEventId();
        const missed = yield* enqueue(JOB_KINDS, "noop", {}, "missed");
        yield* waitForJob(missed.id, finished);

        const stream = yield* subscribe(socket, String(before));
        yield* stream.waitFor((all) =>
          eventTypes(all, missed.id).includes("succeeded")
        );
        expect(stream.messages.some((m) => m.event === "snapshot")).toBe(false);

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.scoped, Effect.provide(layer()))
  );

  it.live("serves a Job's log over the socket", () =>
    Effect.gen(function* () {
      const { stop, fiber, socket } = yield* startSidecar(JOB_KINDS);
      const job = yield* enqueue(JOB_KINDS, "noop", { failAttempts: 99 });
      yield* waitForJob(job.id, finished);

      const read = yield* request(socket, "GET", `/jobs/${job.id}/log`);
      expect(read.status).toBe(200);
      expect(read.body.log).toContain("NoopJobFailedError");
      const missing = yield* request(socket, "GET", "/jobs/nope/log");
      expect(missing.status).toBe(404);

      yield* Deferred.succeed(stop, "test over");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(layer()))
  );

  it.live(
    "on start, recovers a Job a dead sidecar left running, and runs it again",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const job = yield* enqueue(JOB_KINDS, "noop", {});
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);

        const { stop, fiber } = yield* startSidecar(JOB_KINDS);
        const done = yield* waitForJob(job.id, finished);
        expect(done).toMatchObject({ status: "succeeded", attempt: 2 });

        yield* Deferred.succeed(stop, "test over");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "after recovering a lost run, lets its kind clean up — and not after a deliberate stop",
    () =>
      Effect.gen(function* () {
        const lost: string[] = [];
        const kinds = {
          tidy: defineJobKind({
            lane: "default",
            maxAttempts: 1,
            params: Schema.Struct({ wait: Schema.Boolean }),
            run: (params) => (params.wait ? Effect.never : Effect.void),
            afterLostRun: (job) =>
              Effect.sync(() => {
                lost.push(job.id);
              }),
          }),
        } as const;
        const ops = yield* JobOperationsService;

        // A run a dead sidecar left behind: recovery settles it, then the
        // kind hears of it, once.
        const dead = yield* enqueue(kinds, "tidy", { wait: false });
        yield* ops.claimNextJob({
          lane: "default",
          holder: "dead",
          leaseMs: 1,
        });
        yield* Effect.sleep(5);
        const first = yield* startSidecar(kinds);
        expect(yield* waitForJob(dead.id, finished)).toMatchObject({
          status: "interrupted",
        });
        expect(lost).toEqual([dead.id]);

        // A run stopped on purpose goes back to the queue: nothing was lost.
        const stopped = yield* enqueue(kinds, "tidy", { wait: true });
        yield* waitForJob(stopped.id, (job) => job.status === "running");
        yield* Deferred.succeed(first.stop, "test over");
        yield* Fiber.join(first.fiber);
        expect(yield* ops.getJob(stopped.id)).toMatchObject({
          status: "queued",
        });
        expect(lost).toEqual([dead.id]);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "does not start beside a live sidecar on the same database, and names it",
    () =>
      Effect.gen(function* () {
        const first = yield* startSidecar(JOB_KINDS);
        const second = yield* startSidecar(JOB_KINDS, "second");

        expect(yield* Fiber.join(second.fiber)).toMatchObject({
          _tag: "LeaseHeld",
          lease: { checkout: "/checkouts/first" },
        });

        yield* Deferred.succeed(first.stop, "test over");
        yield* Fiber.join(first.fiber);
      }).pipe(Effect.provide(layer()))
  );
});
