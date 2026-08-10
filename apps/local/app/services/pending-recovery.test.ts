/**
 * Reconcile-on-load classification for a crash-stranded Pending Version
 * (issues #1350/#1404). The classifier correlates the course's Pending row
 * (at most one, by the partial unique index) against the root Dropbox
 * `course.json` receipt downloaded via the Dropbox HTTP API.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  createFakeDropbox,
  FAKE_ACCESS_TOKEN,
} from "@/test-utils/fake-dropbox";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { classifyPendingRecovery } from "@/services/pending-recovery.server";
import { dropboxAuth } from "@/db/schema";

let testDb: TestDb;
let fakeDropbox: ReturnType<typeof createFakeDropbox>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

afterEach(() => {
  fakeDropbox?.cleanup();
});

const COURSE_NAME = "recovery-course";
const DROPBOX_REMOTE_PATH = "/Courses";

const setup = async () => {
  await truncateAllTables(testDb);

  fakeDropbox = createFakeDropbox();
  fakeDropbox.install();

  // Seed Dropbox auth.
  await testDb.insert(dropboxAuth).values({
    accessToken: FAKE_ACCESS_TOKEN,
    refreshToken: "fake-refresh-token",
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    LinkAuthOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer), Layer.merge(NodeContext.layer));

  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(dbLayer),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([["DROPBOX_REMOTE_PATH", DROPBOX_REMOTE_PATH]])
          )
        )
      ) as Effect.Effect<A, E, never>
    ) as Promise<A>;

  const seeded = await run(
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const course = yield* courseOps.createCourse({ name: COURSE_NAME });
      const version = yield* versionOps.createCourseVersion({
        repoId: course.id,
        name: "",
      });
      return { course, version };
    })
  );

  const submit = () =>
    run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: seeded.version.id,
          repoId: seeded.course.id,
          newVersionName: "",
          sourceName: "v1.0.0",
          sourceDescription: "First release",
        });
      })
    );

  const classify = () =>
    run(
      classifyPendingRecovery({
        courseId: seeded.course.id,
        courseName: COURSE_NAME,
      })
    );

  const writeReceipt = (contents: string) => {
    fakeDropbox.store(
      `${DROPBOX_REMOTE_PATH}/${COURSE_NAME}/course.json`,
      Buffer.from(contents, "utf-8")
    );
  };

  return { ...seeded, run, submit, classify, writeReceipt };
};

describe("classifyPendingRecovery (#1404)", () => {
  it("returns null when the course has no Pending Version", async () => {
    const { classify } = await setup();
    expect(await classify()).toBeNull();
  });

  it("classifies a Pending with no receipt as provably absent", async () => {
    const { submit, classify, version } = await setup();
    await submit();
    expect(await classify()).toEqual({
      versionId: version.id,
      versionName: "v1.0.0",
      receiptState: "absent",
    });
  });

  it("classifies a Pending whose receipt names it as committed", async () => {
    const { submit, classify, writeReceipt, version } = await setup();
    await submit();
    writeReceipt(JSON.stringify({ courseVersionId: version.id }));
    expect(await classify()).toEqual({
      versionId: version.id,
      versionName: "v1.0.0",
      receiptState: "committed",
    });
  });

  it("a receipt naming an earlier version is absent for this Pending", async () => {
    const { submit, classify, writeReceipt } = await setup();
    await submit();
    writeReceipt(JSON.stringify({ courseVersionId: "some-older-id" }));
    expect((await classify())?.receiptState).toBe("absent");
  });

  it("an unparseable receipt refuses to classify (unreadable)", async () => {
    const { submit, classify, writeReceipt } = await setup();
    await submit();
    writeReceipt("{ not json");
    expect((await classify())?.receiptState).toBe("unreadable");
  });

  it("no Dropbox auth refuses to classify (unreadable)", async () => {
    const { submit, run, course } = await setup();
    await submit();
    // Delete the auth row so getValidDropboxAccessToken fails.
    await testDb.delete(dropboxAuth);
    const result = await run(
      classifyPendingRecovery({
        courseId: course.id,
        courseName: COURSE_NAME,
      })
    );
    expect(result?.receiptState).toBe("unreadable");
  });
});
