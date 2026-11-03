import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { waitForPublishJob } from "./course-publish-wait";

// `cvm course publish --wait` follows the Publish Job the Sidecar runs and
// ends as the in-process command did: the same result object, the same
// tagged errors — so `render.ts` gives the same exit codes (3 for a refused
// Publish, 4 for a failed Commit). Here a test plays the sidecar.

let testDb: TestDb;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const layer = () =>
  JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );

/** A queued Publish Job, as `enqueueJob` writes it. */
const enqueue = Effect.gen(function* () {
  const ops = yield* JobOperationsService;
  return yield* ops.enqueueJob({
    id: null,
    kind: "publish",
    title: "Generics",
    lane: "publish",
    params: {},
    maxAttempts: 1,
    dependsOn: null,
    subject: { type: "course", id: "course-1" },
  });
});

/** Play the sidecar: claim the Job, write `events`, then end it as `end` says. */
const runAsSidecar = (
  events: { type: string; data: Record<string, unknown> }[],
  end: "succeed" | "fail" | "lose",
  failureTag = "PublishRunError"
) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const job = yield* ops.claimNextJob({
      lane: "publish",
      holder: "test-sidecar",
      leaseMs: end === "lose" ? 1 : 30_000,
    });
    if (!job) return yield* Effect.dieMessage("nothing to claim");
    for (const event of events) {
      yield* ops.appendJobEvent({ jobId: job.id, ...event });
    }
    if (end === "succeed") {
      yield* ops.completeJob({ jobId: job.id, holder: "test-sidecar" });
    } else if (end === "fail") {
      yield* ops.failJobAttempt({
        jobId: job.id,
        holder: "test-sidecar",
        failure: {
          tag: failureTag,
          message: "2 course warning(s) must be fixed",
          cause: `${failureTag}: …`,
        },
        interrupted: false,
        mayRetry: false,
      });
    } else {
      yield* Effect.sleep(5);
      yield* ops.recoverExpiredJobs({
        holderGoneAfterMs: 0,
        neverRetryKinds: {},
        stillRunning: [],
      });
    }
  });

const follow = (jobId: string, lines: Record<string, unknown>[]) =>
  waitForPublishJob({
    jobId,
    pollMs: 10,
    onProgress: (line) => Effect.sync(() => lines.push(line)),
  });

describe("cvm course publish --wait", () => {
  it.live(
    "prints the release the Job published, and a line per step on the way",
    () =>
      Effect.gen(function* () {
        const job = yield* enqueue;
        const lines: Record<string, unknown>[] = [];
        const following = yield* Effect.fork(follow(job.id, lines));
        yield* Effect.sleep(30);
        yield* runAsSidecar(
          [
            { type: "stage", data: { stage: "validating" } },
            {
              type: "videos",
              data: { videos: [{ id: "video-a", title: "S1/L1" }] },
            },
            { type: "video-succeeded", data: { videoId: "video-a" } },
            {
              type: "published",
              data: {
                publishedVersionId: "version-1",
                newDraftVersionId: "version-2",
                lessons: { ships: 1, placeholders: 0, withheld: 0 },
              },
            },
          ],
          "succeed"
        );
        const result = yield* following.await.pipe(
          Effect.flatMap((exit) => exit)
        );
        expect(result).toEqual({
          publishedVersionId: "version-1",
          newDraftVersionId: "version-2",
          lessons: { ships: 1, placeholders: 0, withheld: 0 },
        });
        expect(lines).toEqual([
          { event: "queued" },
          { event: "waiting", message: expect.stringContaining("sidecar") },
          { event: "started" },
          { event: "stage", stage: "validating" },
          { event: "videos", count: 1 },
          { event: "video-shipped", videoId: "video-a" },
          { event: "succeeded" },
        ]);
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "a refused Publish ends with the service's own tagged error (exit 3)",
    () =>
      Effect.gen(function* () {
        const job = yield* enqueue;
        yield* runAsSidecar(
          [
            {
              type: "publish-failed",
              data: {
                _tag: "PublishValidationError",
                courseViewLintCount: 2,
              },
            },
          ],
          "fail"
        );
        const error = yield* follow(job.id, []).pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "PublishValidationError",
          courseViewLintCount: 2,
        });
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "a refused Publish still exits 3 when its publish-failed event was never written",
    () =>
      Effect.gen(function* () {
        // `ctx.emit` swallows a failed event write; the Job's own failure
        // tag is the one record that survives.
        const job = yield* enqueue;
        yield* runAsSidecar([], "fail", "PublishRefusedError");
        const error = yield* follow(job.id, []).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "PublishValidationError" });
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "a Publish that failed after Submit (its Promote failed) points at Promote / Discard on the publish page",
    () =>
      Effect.gen(function* () {
        const job = yield* enqueue;
        yield* runAsSidecar(
          [
            { type: "submitted", data: { pendingVersionId: "version-1" } },
            {
              type: "publish-failed",
              data: { _tag: "VersionNotPendingError", versionId: "version-1" },
            },
          ],
          "fail",
          "VersionNotPendingError"
        );
        const error = yield* follow(job.id, []).pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "PublishJobFailedError",
          cause: "VersionNotPendingError",
        });
        expect(error.message).toContain("Promote or Discard");
        expect(error.message).toContain("/courses/course-1/publish");
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "a Publish that failed before Submit gives no Promote / Discard hint",
    () =>
      Effect.gen(function* () {
        const job = yield* enqueue;
        yield* runAsSidecar([], "fail", "DatabaseError");
        const error = yield* follow(job.id, []).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "PublishJobFailedError" });
        expect(error.message).not.toContain("Promote or Discard");
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "a Job that succeeded without its published event is an error, not a release with empty ids",
    () =>
      Effect.gen(function* () {
        const job = yield* enqueue;
        yield* runAsSidecar([], "succeed");
        const error = yield* follow(job.id, []).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "PublishResultLostError" });
        expect(error.message).toContain("cvm course");
      }).pipe(Effect.provide(layer()))
  );

  it.live(
    "a Publish cut off by a dead sidecar ends PublishInterruptedError, pointing at Promote / Discard",
    () =>
      Effect.gen(function* () {
        const job = yield* enqueue;
        yield* runAsSidecar([], "lose");
        const error = yield* follow(job.id, []).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "PublishInterruptedError" });
        expect(error.message).toContain("Promote or Discard");
      }).pipe(Effect.provide(layer()))
  );
});
