import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Cause, Effect, Layer, Logger, ManagedRuntime } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import type { StorageRoots } from "../index";
import { assignStorageBuckets, type StorageScanMessage } from "../buckets";
import { streamStorageScan, type DirtyBitReader } from "../scan";

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let scratch: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;

/** Write a file of `bytes` bytes under a root (or any folder). */
const put = (dir: string, relative: string, bytes: number) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes));
};

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-scan-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  scratch = path.join(base, "scratch");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
  dirtyRoots = new Set();
  askedDirtyBit = [];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

let order = 0;

/** A Course with one Version, Section and Lesson; returns the Lesson id. */
const seedCourse = async (name: string) => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1 })
    .returning();
  return { courseId: course!.id, lessonId: lesson!.id };
};

const seedVideo = async (opts: {
  lessonId?: string;
  format?: "landscape" | "short";
  footage: string[];
}) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "v",
      originalFootagePath: "",
      lessonId: opts.lessonId ?? null,
      format: opts.format ?? "landscape",
    })
    .returning();
  for (const stored of opts.footage) {
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: stored,
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: `a${order++}`,
      text: "",
    });
  }
  return video!.id;
};

/**
 * The fake dirty-bit reader: `dirtyRoots` report Dirty, every other root
 * clean. Records which roots were asked about.
 */
let dirtyRoots: Set<string>;
let askedDirtyBit: string[];
const fakeDirtyBit: DirtyBitReader = (root) =>
  Effect.sync(() => {
    askedDirtyBit.push(root);
    return dirtyRoots.has(root) ? "dirty" : "clean";
  });

/** Run the scan to the end, keeping every message. */
const scan = async () => {
  const messages: StorageScanMessage[] = [];
  await Effect.runPromise(
    streamStorageScan({
      db: db(),
      roots,
      scratchDir: scratch,
      readDirtyBit: fakeDirtyBit,
      emit: (m) => messages.push(m),
    }).pipe(Effect.provide(NodeContext.layer))
  );
  return messages;
};

/** bucket id → location → kind → bytes, added up from the deltas. */
const totals = (messages: StorageScanMessage[]) => {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const m of messages) {
    if (m.type !== "sizes-counted") continue;
    for (const s of m.sizes) {
      const byLocation = (out[s.bucketId] ??= {});
      const byKind = (byLocation[s.location] ??= {});
      byKind[s.kind] = (byKind[s.kind] ?? 0) + s.bytes;
    }
  }
  return out;
};

describe("streamStorageScan", () => {
  it("counts every file in its Storage Bucket, per root and per kind", async () => {
    const a = await seedCourse("Course A");
    const b = await seedCourse("Course B");
    const videoA = await seedVideo({
      lessonId: a.lessonId,
      // A legacy absolute path reads as its root-relative form.
      footage: [path.join(d, "raw-footage/a.mkv"), "raw-footage/shared.mkv"],
    });
    await seedVideo({
      lessonId: b.lessonId,
      footage: ["raw-footage/shared.mkv"],
    });
    // Also uses Course A's take: Footage of one Course stays that Course's.
    const standalone = await seedVideo({
      footage: ["raw-footage/s.mkv", "raw-footage/a.mkv"],
    });
    const short = await seedVideo({
      format: "short",
      footage: ["raw-footage/short.mkv"],
    });

    // Course A's current Exported Video, named by its Export Hash.
    const [exportedA] = (await listVideosForExportHash(db())).filter(
      (v) => v.id === videoA
    );
    const hash = computeExportHash(
      toExportClips(exportedA!.clips),
      exportedA!.format,
      roots
    );
    const currentA = `${a.courseId}-${hash}.mp4`;

    put(d, "raw-footage/a.mkv", 100);
    put(d, "raw-footage/a.mkv.transcript.json", 5);
    put(e, "raw-footage/a.mkv", 100); // mid-move: on both roots
    put(e, "raw-footage/shared.mkv", 200);
    put(d, "raw-footage/s.mkv", 30);
    put(d, "raw-footage/short.mkv", 40);
    put(d, "raw-footage/nested/unused.mkv", 70);
    put(d, `finished-videos/${currentA}`, 300);
    put(d, `finished-videos/${currentA}.sha256`, 1);
    // A stale export (no Video's current Export Hash): orphaned.
    put(e, `finished-videos/${standalone}-${"0".repeat(32)}.mp4`, 9);
    put(d, `finished-videos/${short}.mp4`, 20);
    put(d, `finished-videos/${a.courseId}-${"f".repeat(32)}.mp4`, 11);
    put(d, "clip-mockups/m/1.png", 3);
    put(e, "overlay-renders/r.png", 4);
    put(d, "not-cvm/elsewhere.mkv", 999); // outside CVM's folders: not walked
    put(scratch, "abc.mp4", 7);

    const messages = await scan();

    expect(messages[0]).toMatchObject({
      type: "roots-measured",
      roots: [
        { root: d, online: true },
        { root: e, online: true },
      ],
    });
    const listed = messages.find((m) => m.type === "buckets-listed");
    expect(
      listed?.type === "buckets-listed" &&
        listed.buckets.find((bucket) => bucket.id === "shared-footage")
    ).toEqual({
      id: "shared-footage",
      kind: "shared-footage",
      name: "Shared Footage",
      sharedBy: ["Course A", "Course B"],
    });
    expect(messages.at(-1)).toEqual({ type: "scan-completed" });

    expect(totals(messages)).toEqual({
      [`course:${a.courseId}`]: {
        [d]: { footage: 105, "exported-videos": 301 },
        [e]: { footage: 100 },
      },
      "shared-footage": { [e]: { footage: 200 } },
      "standalone-videos": { [d]: { footage: 30 } },
      shorts: { [d]: { footage: 40, "exported-videos": 20 } },
      "unused-footage": { [d]: { footage: 70 } },
      "orphaned-exports": {
        [d]: { "exported-videos": 11 },
        [e]: { "exported-videos": 9 },
      },
      "clip-mockups": { [d]: { other: 3 } },
      "overlay-render-cache": { [e]: { other: 4 } },
      "export-scratch": { [scratch]: { other: 7 } },
    });
  });

  it("counts Imported Footage in Used or Unused Imported Footage, never in a Course", async () => {
    const a = await seedCourse("Course A");
    await seedVideo({
      lessonId: a.lessonId,
      footage: ["raw-footage/imported/interview.mp4", "raw-footage/a.mkv"],
    });
    const standalone = await seedVideo({ footage: [] });
    // An archived Clip uses its Footage too: it can come back.
    await testDb.insert(schema.clips).values({
      videoId: standalone,
      videoFilename: path.join(d, "raw-footage/imported/broll/city.mp4"),
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: `a${order++}`,
      text: "",
      archived: true,
    });

    put(d, "raw-footage/a.mkv", 1);
    put(d, "raw-footage/imported/interview.mp4", 100);
    put(d, "raw-footage/imported/interview.mp4.transcript.json", 5);
    put(e, "raw-footage/imported/broll/city.mp4", 20);
    put(d, "raw-footage/imported/unused.mp4", 50);
    put(d, "raw-footage/imported/unused.mp4.transcript.json", 3);

    const messages = await scan();

    const listed = messages.find((m) => m.type === "buckets-listed");
    expect(
      listed?.type === "buckets-listed" &&
        listed.buckets.filter((b) => b.kind.endsWith("imported-footage"))
    ).toEqual([
      {
        id: "used-imported-footage",
        kind: "used-imported-footage",
        name: "Used Imported Footage",
        sharedBy: ["Course A"],
      },
      {
        id: "unused-imported-footage",
        kind: "unused-imported-footage",
        name: "Unused Imported Footage",
      },
    ]);
    expect(totals(messages)).toEqual({
      [`course:${a.courseId}`]: { [d]: { footage: 1 } },
      "used-imported-footage": {
        [d]: { footage: 105 },
        [e]: { footage: 20 },
      },
      "unused-imported-footage": { [d]: { footage: 53 } },
    });
  });

  it("counts a B-roll's Footage in Used Imported Footage", async () => {
    const a = await seedCourse("Course A");
    const video = await seedVideo({ lessonId: a.lessonId, footage: [] });
    const [clip] = await testDb
      .insert(schema.clips)
      .values({
        videoId: video,
        videoFilename: "raw-footage/take.mkv",
        sourceStartTime: 0,
        sourceEndTime: 10,
        order: `a${order++}`,
        text: "",
      })
      .returning();
    await testDb.insert(schema.overlays).values({
      clipId: clip!.id,
      at: 1,
      durationInSeconds: 3,
      kind: "bRoll",
      title: "",
      description: "",
      footagePath: "raw-footage/imported/city.mp4",
      footageStart: 5,
    });
    put(d, "raw-footage/take.mkv", 1);
    put(d, "raw-footage/imported/city.mp4", 40);

    const sizes = totals(await scan());

    expect(sizes["used-imported-footage"]).toEqual({
      [d]: { footage: 40 },
    });
    expect(sizes["unused-imported-footage"]).toBeUndefined();
  });

  it("shows an unreadable root as Offline, with no sizes for it", async () => {
    await seedVideo({ footage: ["raw-footage/s.mkv"] });
    put(d, "raw-footage/s.mkv", 30);
    put(e, "raw-footage/s.mkv", 30);
    fs.rmSync(e, { recursive: true });

    const messages = await scan();

    expect(messages[0]).toMatchObject({
      type: "roots-measured",
      roots: [
        { root: d, online: true },
        { root: e, online: false },
      ],
    });
    expect(totals(messages)).toEqual({
      "standalone-videos": { [d]: { footage: 30 } },
    });
  });

  it("shows a root it can't list (a stale mount) as Offline", async () => {
    // A stale WSL mount: the path is there, but listing it fails. A plain
    // file standing in for the root fails the same way.
    fs.rmSync(e, { recursive: true });
    fs.writeFileSync(e, "not a directory");

    const messages = await scan();

    expect(messages[0]).toMatchObject({
      type: "roots-measured",
      roots: [
        { root: d, online: true },
        { root: e, online: false },
      ],
    });
  });

  it("reports each online root's dirty bit, and asks nothing of an Offline root", async () => {
    dirtyRoots.add(e);
    const f = path.join(base, "f");
    roots = [d, e, f];

    const messages = await scan();

    expect(messages[0]).toMatchObject({
      type: "roots-measured",
      roots: [
        { root: d, online: true, dirtyBit: "clean" },
        { root: e, online: true, dirtyBit: "dirty" },
        { root: f, online: false },
      ],
    });
    expect(askedDirtyBit.sort()).toEqual([d, e].sort());
  });

  it("writes nothing to any root", async () => {
    await seedVideo({ footage: ["raw-footage/s.mkv"] });
    put(d, "raw-footage/s.mkv", 30);
    put(e, "finished-videos/x.mp4", 5);
    const snapshot = () =>
      fs
        .readdirSync(base, { recursive: true, withFileTypes: true })
        .map((entry) => {
          const full = path.join(entry.parentPath, entry.name);
          const stat = fs.statSync(full);
          return `${full}:${stat.size}:${stat.mtimeMs}`;
        })
        .sort();
    const before = snapshot();

    await scan();

    expect(snapshot()).toEqual(before);
  });

  it("stops the walk when the page closes the stream", async () => {
    for (let i = 0; i < 500; i++) put(d, `raw-footage/${i}.mkv`, 1);
    const lines: string[] = [];
    const logger = Logger.make(({ message, cause }) => {
      lines.push([String(message), Cause.pretty(cause)].join("\n"));
    });
    const runtime = ManagedRuntime.make(
      Layer.merge(
        NodeContext.layer,
        Logger.replace(Logger.defaultLogger, logger)
      )
    );
    const response = createSSEResponse({
      runtime,
      program: (sendEvent) =>
        streamStorageScan({
          db: db(),
          roots,
          readDirtyBit: fakeDirtyBit,
          emit: (m) => sendEvent(m.type, m),
        }),
    });

    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: roots-measured");
    // The page leaves.
    await reader.cancel();

    await expect
      .poll(() => lines.some((l) => l.includes("[storage] scan aborted")))
      .toBe(true);
    expect(lines.some((l) => l.includes("[storage] scan finished"))).toBe(
      false
    );
    await runtime.dispose();
  });
});

describe("assignStorageBuckets", () => {
  it("names the Videos that use each Footage file, by its root-relative path", () => {
    const ownership = assignStorageBuckets(
      {
        courses: [],
        videos: [],
        footageUses: [
          { stored: "/mnt/d/raw-footage/imported/a.mp4", videoId: "v1" },
          { stored: "raw-footage/imported/a.mp4", videoId: "v2" },
          { stored: "raw-footage/imported/a.mp4", videoId: "v1" },
          { stored: "raw-footage/b.mkv", videoId: null },
        ],
      },
      ["/mnt/d"]
    );
    expect(
      Object.fromEntries(
        [...ownership.videosByFootage].map(([p, v]) => [p, [...v]])
      )
    ).toEqual({ "raw-footage/imported/a.mp4": ["v1", "v2"] });
  });
});
