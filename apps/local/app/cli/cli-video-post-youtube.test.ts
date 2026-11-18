import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import {
  computeExportHash,
  resolveExportPath,
  toExportClips,
} from "@/services/export-hash";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import { one, type RunResult } from "./cli-write-test-harness";
import {
  makeJobRun,
  settleAsSidecar,
  settleWhenQueued,
} from "./cli-job-test-harness";

// ===========================================================================
// cvm video post-youtube --thumbnail <id> [--privacy] [--dry-run] [--wait]
//
// It queues the Post page's `youtube` Job; no Sidecar runs here, so nothing
// is ever uploaded — the test plays the Sidecar where a Job must settle.
// STORAGE_ROOTS points at a temp root holding the export and the Thumbnail.
// Every refusal is asserted to leave the Job queue empty. The refusal on a
// Remote Box is in cli-local-only.test.ts.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let root: string;
const originalRoots = process.env.STORAGE_ROOTS;
const originalLocalMachine = process.env[LOCAL_MACHINE_ENV_KEY];

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  run = makeJobRun(testDb);
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
});

afterAll(() => {
  const restore = (key: string, previous: string | undefined) => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
  restore("STORAGE_ROOTS", originalRoots);
  restore(LOCAL_MACHINE_ENV_KEY, originalLocalMachine);
  rmSync(root, { recursive: true, force: true });
});

interface Seed {
  videoId: string;
  lineageId: string;
  thumbnailId: string;
  thumbnailPath: string;
  otherVideoThumbnailId: string;
}
let s: Seed;

const TITLE = "Generics in 10 minutes";
const DESCRIPTION = "Everything you need to know about generics.";

beforeEach(async () => {
  await truncateAllTables(testDb);
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(path.join(tmpdir(), "cvm-post-youtube-"));
  mkdirSync(path.join(root, "finished-videos"));
  process.env.STORAGE_ROOTS = root;

  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "generics.mp4",
      originalFootagePath: "f.mp4",
      youtubeDraftTitle: TITLE,
      youtubeDraftDescription: DESCRIPTION,
    })
    .returning();
  await testDb.insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: "a.mp4",
    sourceStartTime: 0,
    sourceEndTime: 10,
    order: "0001",
    text: "hello",
  });
  const [other] = await testDb
    .insert(schema.videos)
    .values({ title: "other.mp4", originalFootagePath: "f.mp4" })
    .returning();

  const stored = `video-files/${video!.lineageId}/thumbnail.png`;
  mkdirSync(path.join(root, "video-files", video!.lineageId), {
    recursive: true,
  });
  writeFileSync(path.join(root, stored), "png");
  const [thumbnail] = await testDb
    .insert(schema.thumbnails)
    .values({
      videoId: video!.id,
      layers: [],
      filePath: stored,
      selectedForUpload: true,
    })
    .returning();
  const [otherThumbnail] = await testDb
    .insert(schema.thumbnails)
    .values({ videoId: other!.id, layers: [], filePath: stored })
    .returning();

  s = {
    videoId: video!.id,
    lineageId: video!.lineageId,
    thumbnailId: thumbnail!.id,
    thumbnailPath: path.join(root, stored),
    otherVideoThumbnailId: otherThumbnail!.id,
  };
});

/** Write the Video's Exported Video into finished-videos/, as an export does. */
const markExported = async (): Promise<string> => {
  const video = await testDb.query.videos.findFirst({
    where: (v, { eq }) => eq(v.id, s.videoId),
    with: {
      clips: {
        where: (c, { eq }) => eq(c.archived, false),
        with: {
          overlays: true,
          recordingSession: { with: { sceneEvents: true, micEq: true } },
          layers: true,
        },
      },
    },
  });
  const hash = computeExportHash(
    toExportClips(video!.clips),
    video!.format,
    []
  );
  const exportPath = resolveExportPath(
    path.join(root, "finished-videos"),
    s.videoId,
    hash!
  );
  writeFileSync(exportPath, "0123456789");
  return exportPath;
};

const jobs = () => testDb.select().from(schema.jobs);

const failureOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim().split("\n").pop()!);

const post = (...flags: string[]) =>
  run(["video", "post-youtube", ...flags, s.videoId]);

describe("cvm video post-youtube", () => {
  it("--dry-run prints everything it would queue, and queues nothing", async () => {
    const exportPath = await markExported();

    const r = await post("--thumbnail", s.thumbnailId, "--dry-run");

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toEqual({
      dryRun: true,
      videoId: s.videoId,
      title: TITLE,
      description: DESCRIPTION,
      privacyStatus: "unlisted",
      export: { path: exportPath, sizeBytes: 10 },
      thumbnail: {
        id: s.thumbnailId,
        path: s.thumbnailPath,
        selectedForUpload: true,
      },
    });
    expect(await jobs()).toEqual([]);
  });

  it("queues the Post page's youtube Job, unlisted by default, and prints its id", async () => {
    await markExported();

    const r = await post("--thumbnail", s.thumbnailId);

    expect(r.exitCode).toBe(0);
    const out = one<{ jobId: string; status: string; log: string }>(r.stdout);
    expect(out.status).toBe("queued");
    const [job] = await jobs();
    expect(job).toMatchObject({
      id: out.jobId,
      kind: "youtube",
      status: "queued",
      maxAttempts: 1,
      subjectType: "video",
      subjectId: s.videoId,
      params: {
        videoId: s.videoId,
        title: TITLE,
        description: DESCRIPTION,
        privacyStatus: "unlisted",
        thumbnailId: s.thumbnailId,
      },
    });
    expect(out.log).toBe(`.data/logs/jobs/${out.jobId}.jsonl`);
  });

  it("queues it private with --privacy private", async () => {
    await markExported();

    const r = await post("--thumbnail", s.thumbnailId, "--privacy", "private");

    expect(r.exitCode).toBe(0);
    const [job] = await jobs();
    expect(job!.params).toMatchObject({ privacyStatus: "private" });
  });

  it("refuses --privacy public, exit 3, before anything is read", async () => {
    await markExported();

    const r = await post("--thumbnail", s.thumbnailId, "--privacy", "public");

    expect(r.exitCode).toBe(3);
    expect(await jobs()).toEqual([]);
  });

  it("requires --thumbnail: there is no default and no path flag", async () => {
    await markExported();

    const r = await post();

    expect(r.exitCode).toBe(3);
    expect(await jobs()).toEqual([]);
  });

  describe("refuses a Thumbnail the upload must never send, exit 3", () => {
    it.each([
      ["not-found", (): string => "no-such-thumbnail"],
      ["other-video", (): string => s.otherVideoThumbnailId],
    ] as const)("%s", async (reason, thumbnailId) => {
      await markExported();

      const r = await post("--thumbnail", thumbnailId());

      expect(r.exitCode).toBe(3);
      expect(failureOf(r)).toMatchObject({
        _tag: "ThumbnailNotUploadableError",
        reason,
      });
      expect(await jobs()).toEqual([]);
    });

    it("archived", async () => {
      await markExported();
      await testDb
        .update(schema.thumbnails)
        .set({ archivedAt: new Date() })
        .where(eq(schema.thumbnails.id, s.thumbnailId));

      const r = await post("--thumbnail", s.thumbnailId);

      expect(r.exitCode).toBe(3);
      expect(failureOf(r)).toMatchObject({ reason: "archived" });
      expect(await jobs()).toEqual([]);
    });

    it("no-file", async () => {
      await markExported();
      await testDb
        .update(schema.thumbnails)
        .set({ filePath: null })
        .where(eq(schema.thumbnails.id, s.thumbnailId));

      const r = await post("--thumbnail", s.thumbnailId);

      expect(r.exitCode).toBe(3);
      expect(failureOf(r)).toMatchObject({ reason: "no-file" });
      expect(await jobs()).toEqual([]);
    });

    it("its file gone from disk", async () => {
      await markExported();
      rmSync(s.thumbnailPath);

      const r = await post("--thumbnail", s.thumbnailId, "--dry-run");

      expect(r.exitCode).toBe(3);
      expect(failureOf(r)).toMatchObject({ _tag: "ParseError" });
      expect(failureOf(r).message).toContain("not on disk");
    });
  });

  it("refuses a Video that is not exported, exit 3", async () => {
    const r = await post("--thumbnail", s.thumbnailId);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("has not been exported");
    expect(await jobs()).toEqual([]);
  });

  it("refuses a Video with no YouTube description, exit 3", async () => {
    await markExported();
    await testDb
      .update(schema.videos)
      .set({ youtubeDraftDescription: null })
      .where(eq(schema.videos.id, s.videoId));

    const r = await post("--thumbnail", s.thumbnailId);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("no YouTube description");
    expect(await jobs()).toEqual([]);
  });

  it("takes the Pitch's YouTube title when none was typed, as the Post page does", async () => {
    await markExported();
    const [pitch] = await testDb
      .insert(schema.pitches)
      .values({ title: "Generics", youtubeTitle: "Generics, from the Pitch" })
      .returning();
    await testDb
      .update(schema.videos)
      .set({ youtubeDraftTitle: null, pitchId: pitch!.id })
      .where(eq(schema.videos.id, s.videoId));

    const r = await post("--thumbnail", s.thumbnailId, "--dry-run");

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toMatchObject({ title: "Generics, from the Pitch" });
  });

  it("refuses a title YouTube would refuse, exit 3", async () => {
    await markExported();
    await testDb
      .update(schema.videos)
      .set({ youtubeDraftTitle: "Generics <T>" })
      .where(eq(schema.videos.id, s.videoId));

    const r = await post("--thumbnail", s.thumbnailId);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("YouTube refuses");
    expect(await jobs()).toEqual([]);
  });

  it("refuses a Short, exit 3: Shorts go through the Posting Queue", async () => {
    await markExported();
    await testDb
      .update(schema.videos)
      .set({ format: "short" })
      .where(eq(schema.videos.id, s.videoId));

    const r = await post("--thumbnail", s.thumbnailId);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain("cvm short post");
    expect(await jobs()).toEqual([]);
  });

  describe("an earlier upload that reached YouTube", () => {
    const POSTED = {
      type: "posted",
      data: { youtubeVideoId: "yt123", url: "https://studio/yt123" },
    };

    it.each(["succeed", "fail"] as const)(
      "refuses another upload once one has posted (it ended %s), exit 3, naming it",
      async (end) => {
        await markExported();
        await post("--thumbnail", s.thumbnailId);
        await settleAsSidecar(testDb, end, [POSTED]);

        const r = await post("--thumbnail", s.thumbnailId);

        expect(r.exitCode).toBe(3);
        expect(failureOf(r).message).toContain("yt123");
        expect(failureOf(r).message).toContain("--again");
        expect(await jobs()).toHaveLength(1);
      }
    );

    it("refuses it in --dry-run too", async () => {
      await markExported();
      await post("--thumbnail", s.thumbnailId);
      await settleAsSidecar(testDb, "fail", [POSTED]);

      const r = await post("--thumbnail", s.thumbnailId, "--dry-run");

      expect(r.exitCode).toBe(3);
      expect(failureOf(r).message).toContain("yt123");
    });

    it("queues another with --again", async () => {
      await markExported();
      await post("--thumbnail", s.thumbnailId);
      await settleAsSidecar(testDb, "fail", [POSTED]);

      const r = await post("--thumbnail", s.thumbnailId, "--again");

      expect(r.exitCode).toBe(0);
      expect(await jobs()).toHaveLength(2);
    });

    it("does not count an earlier upload that failed before posting", async () => {
      await markExported();
      await post("--thumbnail", s.thumbnailId);
      await settleAsSidecar(testDb, "fail");

      const r = await post("--thumbnail", s.thumbnailId);

      expect(r.exitCode).toBe(0);
      expect(await jobs()).toHaveLength(2);
    });

    it("--wait names what was posted when the Job fails after posting", async () => {
      await markExported();

      const waiting = post("--thumbnail", s.thumbnailId, "--wait");
      await settleWhenQueued(testDb, "fail", [POSTED]);
      const r = await waiting;

      expect(r.exitCode).toBe(4);
      expect(failureOf(r)).toMatchObject({
        _tag: "JobFailedError",
        failed: [{ posted: { youtubeVideoId: "yt123" } }],
      });
      expect(failureOf(r).message).toContain("yt123");
    });
  });

  it("refuses a second upload while the first is queued, exit 3", async () => {
    await markExported();
    const first = await post("--thumbnail", s.thumbnailId);
    const { jobId } = one<{ jobId: string }>(first.stdout);

    const r = await post("--thumbnail", s.thumbnailId);

    expect(r.exitCode).toBe(3);
    expect(failureOf(r).message).toContain(`cvm job wait ${jobId}`);
    expect(await jobs()).toHaveLength(1);
  });

  it("--wait prints the settled Job and what it posted", async () => {
    await markExported();

    const waiting = post("--thumbnail", s.thumbnailId, "--wait");
    await settleWhenQueued(testDb, "succeed", [
      {
        type: "posted",
        data: { youtubeVideoId: "yt123", url: "https://studio/yt123" },
      },
    ]);
    const r = await waiting;

    expect(r.exitCode).toBe(0);
    expect(one(r.stdout)).toMatchObject({
      kind: "youtube",
      status: "succeeded",
      posted: { youtubeVideoId: "yt123" },
    });
  });

  it("--wait ends JobFailedError, exit 4, when the upload fails", async () => {
    await markExported();

    const waiting = post("--thumbnail", s.thumbnailId, "--wait");
    await settleWhenQueued(testDb, "fail");
    const r = await waiting;

    expect(r.exitCode).toBe(4);
    expect(failureOf(r)).toMatchObject({
      _tag: "JobFailedError",
      failed: [{ cause: "YouTubeUploadError" }],
    });
  });
});

describe("cvm thumbnail list", () => {
  it("lists the Video's Thumbnails with their resolved file, never another's or a deleted one", async () => {
    const [archived] = await testDb
      .insert(schema.thumbnails)
      .values({
        videoId: s.videoId,
        layers: [],
        filePath: null,
        archivedAt: new Date(),
      })
      .returning();

    const r = await run(["thumbnail", "list", "--video", s.videoId]);

    expect(r.exitCode).toBe(0);
    const rows = r.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toEqual([
      {
        id: s.thumbnailId,
        selectedForUpload: true,
        createdAt: expect.any(String),
        filePath: s.thumbnailPath,
        exists: true,
      },
    ]);
    expect(archived).toBeTruthy();
  });
});
