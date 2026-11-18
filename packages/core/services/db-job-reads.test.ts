import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { JobOperationsService } from "./db-job-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

// `cvm job list`: the Jobs an agent can wait on, newest first, narrowed by
// kind, status and the Video they are about.

let testDb: TestDb;
let testLayer: Layer.Layer<JobOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  testLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const enqueue = (input: {
  kind: string;
  subject: { type: string; id: string } | null;
}) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.enqueueJob({
      id: null,
      kind: input.kind,
      title: input.kind,
      lane: "posting",
      params: {},
      maxAttempts: 1,
      dependsOn: null,
      subject: input.subject,
    })
  );

describe("listJobs", () => {
  it.effect("lists every Job newest first, up to the limit", () =>
    Effect.gen(function* () {
      const first = yield* enqueue({ kind: "export", subject: null });
      const second = yield* enqueue({ kind: "youtube", subject: null });
      const ops = yield* JobOperationsService;

      const all = yield* ops.listJobs({ limit: 10 });
      expect(all.map((j) => j.id)).toEqual([second.id, first.id]);

      const one = yield* ops.listJobs({ limit: 1 });
      expect(one.map((j) => j.id)).toEqual([second.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("narrows by kind, status and Video", () =>
    Effect.gen(function* () {
      const video = { type: "video", id: "v1" };
      const upload = yield* enqueue({ kind: "youtube", subject: video });
      yield* enqueue({ kind: "export", subject: video });
      yield* enqueue({ kind: "youtube", subject: { type: "video", id: "v2" } });
      // A Job about something else with the same id is not this Video's.
      yield* enqueue({
        kind: "youtube",
        subject: { type: "course", id: "v1" },
      });
      const ops = yield* JobOperationsService;

      const found = yield* ops.listJobs({
        kind: "youtube",
        status: "queued",
        videoId: "v1",
        limit: 10,
      });
      expect(found.map((j) => j.id)).toEqual([upload.id]);

      const none = yield* ops.listJobs({ status: "succeeded", limit: 10 });
      expect(none).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});
