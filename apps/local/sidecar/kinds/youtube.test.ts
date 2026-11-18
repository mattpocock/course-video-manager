import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { eq } from "drizzle-orm";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { CoursePublishService } from "@/services/course-publish-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import type { JobContext } from "../job-kind";
import { youtubeJobKind } from "./youtube";

// The `youtube` Job checks its Thumbnail BEFORE anything is sent: this
// Video's own, rendered, not archived (`loadUploadableThumbnail`, the check
// `cvm video post-youtube` makes too). Its Publish service is faked and
// answers "not exported", so a Job that passes the Thumbnail check stops at
// the export, before any token is read or any request is made: nothing here
// can reach YouTube.

let testDb: TestDb;
let root: string;
const originalRoots = process.env.STORAGE_ROOTS;
/** How many runs got as far as asking where the export is. */
let reachedExport = 0;

const fakePublish = Layer.succeed(CoursePublishService, {
  resolveExportPath: () =>
    Effect.sync(() => {
      reachedExport += 1;
      return null;
    }),
} as never);

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  root = mkdtempSync(path.join(tmpdir(), "cvm-youtube-kind-"));
  process.env.STORAGE_ROOTS = root;
});

afterAll(() => {
  if (originalRoots === undefined) delete process.env.STORAGE_ROOTS;
  else process.env.STORAGE_ROOTS = originalRoots;
  rmSync(root, { recursive: true, force: true });
});

let videoId: string;
let thumbnailId: string;
let otherVideoThumbnailId: string;

beforeEach(async () => {
  await truncateAllTables(testDb);
  reachedExport = 0;
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "generics.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [other] = await testDb
    .insert(schema.videos)
    .values({ title: "other.mp4", originalFootagePath: "f.mp4" })
    .returning();
  const [thumbnail] = await testDb
    .insert(schema.thumbnails)
    .values({ videoId: video!.id, layers: [], filePath: "video-files/x/t.png" })
    .returning();
  const [otherThumbnail] = await testDb
    .insert(schema.thumbnails)
    .values({ videoId: other!.id, layers: [], filePath: "video-files/y/t.png" })
    .returning();
  videoId = video!.id;
  thumbnailId = thumbnail!.id;
  otherVideoThumbnailId = otherThumbnail!.id;
});

const ctx: JobContext = {
  jobId: "job-1",
  attempt: 1,
  maxAttempts: 1,
  emit: () => Effect.void,
  enqueue: () => Effect.die("the youtube Job starts no other Job"),
};

const runJob = (thumbnail: string) =>
  Effect.runPromiseExit(
    youtubeJobKind
      .runRaw(
        {
          videoId,
          title: "Generics",
          description: "All about generics.",
          privacyStatus: "unlisted",
          thumbnailId: thumbnail,
        },
        ctx
      )
      .pipe(
        Effect.provide(
          Layer.merge(
            ThumbnailOperationsService.Default.pipe(
              Layer.provide(Layer.succeed(DrizzleService, testDb as never))
            ),
            fakePublish
          )
        )
        // Nothing past the export check runs (the fake says "not
        // exported"), so the YouTube auth it would read is never needed.
      ) as Effect.Effect<void, unknown>
  );

const failureOf = (exit: Exit.Exit<void, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error("the Job succeeded");
  return Cause.failureOption(exit.cause).pipe((o) =>
    o._tag === "Some" ? (o.value as { _tag: string; message: string }) : null
  );
};

describe("the youtube Job's Thumbnail check", () => {
  it.each([
    ["no such Thumbnail", () => "no-such-thumbnail"],
    ["another Video's Thumbnail", () => otherVideoThumbnailId],
  ])("refuses %s before reading the export", async (_, thumbnail) => {
    const failure = failureOf(await runJob(thumbnail()));

    expect(failure).toMatchObject({
      _tag: "PostNotStartedError",
      message: "A thumbnail must be selected before uploading",
    });
    expect(reachedExport).toBe(0);
  });

  it.each([
    ["an archived Thumbnail", { archivedAt: new Date() }],
    ["a Thumbnail with no file", { filePath: null }],
  ])("refuses %s before reading the export", async (_, change) => {
    await testDb
      .update(schema.thumbnails)
      .set(change)
      .where(eq(schema.thumbnails.id, thumbnailId));

    const failure = failureOf(await runJob(thumbnailId));

    expect(failure?._tag).toBe("PostNotStartedError");
    expect(reachedExport).toBe(0);
  });

  it("lets this Video's own Thumbnail through to the export check", async () => {
    const failure = failureOf(await runJob(thumbnailId));

    expect(reachedExport).toBe(1);
    expect(failure).toMatchObject({
      _tag: "PostNotStartedError",
      message: "Video has not been exported",
    });
  });
});
