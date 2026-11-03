/**
 * `cvm course publish discard` (#2621): Discard a stranded Pending Version
 * without the publish page, behind the same guards the page's banner has.
 * The `course.json` receipt is read from the in-memory Dropbox fake.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import {
  createFakeDropbox,
  FAKE_ACCESS_TOKEN,
} from "@/test-utils/fake-dropbox";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { discardStrandedPendingVersion } from "@/services/pending-recovery.server";
import { dropboxAuth } from "@/db/schema";

let testDb: TestDb;
let fakeDropbox: ReturnType<typeof createFakeDropbox>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

afterEach(() => {
  fakeDropbox?.cleanup();
});

const COURSE_NAME = "discard-course";
const DROPBOX_REMOTE_PATH = "/Courses";

const setup = async () => {
  await truncateAllTables(testDb);
  fakeDropbox = createFakeDropbox();
  fakeDropbox.install();
  await testDb.insert(dropboxAuth).values({
    accessToken: FAKE_ACCESS_TOKEN,
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });

  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LinkAuthOperationsService.Default,
    JobOperationsService.Default
  ).pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any)),
    Layer.merge(NodeContext.layer)
  );

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      Effect.either(effect).pipe(
        Effect.provide(dbLayer),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([["DROPBOX_REMOTE_PATH", DROPBOX_REMOTE_PATH]])
          )
        )
      ) as Effect.Effect<any, never, never>
    );

  const { right: seeded } = await run(
    Effect.gen(function* () {
      const course = yield* (yield* CourseOperationsService).createCourse({
        name: COURSE_NAME,
      });
      const version =
        yield* (yield* VersionOperationsService).createCourseVersion({
          repoId: course.id,
          name: "",
        });
      return { course, version };
    })
  );

  const submit = () =>
    run(
      Effect.flatMap(VersionOperationsService, (ops) =>
        ops.freezeAndCloneVersion({
          sourceVersionId: seeded.version.id,
          repoId: seeded.course.id,
          newVersionName: "",
          sourceName: "v1.0.0",
          sourceDescription: "First release",
        })
      )
    );

  const discard = () =>
    run(discardStrandedPendingVersion({ courseId: seeded.course.id }));

  const pending = () =>
    run(
      Effect.flatMap(VersionOperationsService, (ops) =>
        ops.getPendingVersion(seeded.course.id)
      )
    ).then((r) => r.right);

  const enqueuePublish = (status: "queued" | "running" | "interrupted") =>
    run(
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const job = yield* ops.enqueueJob({
          id: null,
          kind: "publish",
          title: COURSE_NAME,
          lane: "publish",
          params: {},
          maxAttempts: 1,
          dependsOn: null,
          subject: { type: "course", id: seeded.course.id },
        });
        if (status === "queued") return;
        yield* ops.claimNextJob({
          lane: "publish",
          holder: "a-sidecar",
          leaseMs: 60_000,
        });
        if (status === "interrupted") {
          yield* ops.failJobAttempt({
            jobId: job.id,
            holder: "a-sidecar",
            failure: { tag: "JobInterrupted", message: "stopped", cause: "" },
            interrupted: true,
            mayRetry: false,
            resumable: false,
          });
        }
      })
    ).then((r) => {
      if (r._tag === "Left") throw r.left;
    });

  const writeReceipt = (versionId: string) =>
    fakeDropbox.store(
      `${DROPBOX_REMOTE_PATH}/${COURSE_NAME}/course.json`,
      Buffer.from(JSON.stringify({ courseVersionId: versionId }), "utf-8")
    );

  return { ...seeded, submit, discard, pending, enqueuePublish, writeReceipt };
};

describe("discardStrandedPendingVersion", () => {
  it("Discards a Pending Version whose release never landed", async () => {
    const { submit, discard, pending, version } = await setup();
    await submit();
    expect((await discard()).right).toEqual({
      discardedVersionId: version.id,
      name: "v1.0.0",
    });
    expect(await pending()).toBeUndefined();
  });

  it("Discards one whose Publish was interrupted", async () => {
    const { submit, discard, pending, enqueuePublish } = await setup();
    await submit();
    await enqueuePublish("interrupted");
    expect((await discard())._tag).toBe("Right");
    expect(await pending()).toBeUndefined();
  });

  it.each(["queued", "running"] as const)(
    "refuses while this course's Publish is %s",
    async (status) => {
      const { submit, discard, pending, enqueuePublish } = await setup();
      await submit();
      await enqueuePublish(status);
      expect((await discard()).left).toMatchObject({
        _tag: "PendingDiscardRefusedError",
        reason: "publish-in-flight",
      });
      expect(await pending()).toBeDefined();
    }
  );

  it("refuses one whose release landed: that one is Promoted", async () => {
    const { submit, discard, pending, writeReceipt, version } = await setup();
    await submit();
    writeReceipt(version.id);
    expect((await discard()).left).toMatchObject({
      _tag: "PendingDiscardRefusedError",
      reason: "release-landed",
    });
    expect(await pending()).toBeDefined();
  });

  it("refuses when the receipt cannot be read", async () => {
    const { submit, discard, pending } = await setup();
    await submit();
    await testDb.delete(dropboxAuth);
    expect((await discard()).left).toMatchObject({
      _tag: "PendingDiscardRefusedError",
      reason: "receipt-unreadable",
    });
    expect(await pending()).toBeDefined();
  });

  it("says so when there is no Pending Version", async () => {
    const { discard } = await setup();
    expect((await discard()).left).toMatchObject({ _tag: "NotFoundError" });
  });
});
