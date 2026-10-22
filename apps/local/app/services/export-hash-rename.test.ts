import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageRoots } from "@/packages/storage";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { garbageCollect } from "@/services/export-hash.server";
import {
  applyExportRename,
  EXPORT_HASH_RENAME_MARKER,
  planExportRenameOnDisk,
} from "@/services/export-hash-rename";

/**
 * The switch to root-relative Export Hashes (#2104), end to end on real temp
 * directories as Storage Roots: export GC must not delete a single finished
 * video before the rename has run, and the rename must either rename every
 * export it should or change nothing at all.
 */

let base: string;
let d: string;
let e: string;
let roots: StorageRoots;

const finished = (root: string) => path.join(root, "finished-videos");

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "export-rename-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(finished(d), { recursive: true });
  fs.mkdirSync(finished(e), { recursive: true });
  roots = [d, e];
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const COURSE = "course-1";

const clipRow = (videoFilename: string) => ({
  videoFilename,
  sourceStartTime: 0,
  sourceEndTime: 10,
  recordingSessionId: null,
  sceneOverride: null,
  recordingSession: null,
  pauseType: "none",
  zoomType: "none",
  overlays: [],
});

/** A Course Video whose one Clip's Footage is stored as `videoFilename`. */
const courseVideo = (videoFilename: string, id = "vid-1") => ({
  id,
  format: "landscape",
  courseId: COURSE as string | null,
  clips: [clipRow(videoFilename)],
});

const hashOf = (
  video: ReturnType<typeof courseVideo>,
  hashRoots: readonly string[]
) => computeExportHash(toExportClips(video.clips), video.format, hashRoots)!;

const put = (dir: string, name: string, content = name) => {
  fs.writeFileSync(path.join(dir, name), content);
  return path.join(dir, name);
};

/** Every file under the roots, with its content: "nothing changed" is this, unchanged. */
const snapshot = () =>
  roots.flatMap((root) =>
    fs
      .readdirSync(finished(root))
      .sort()
      .map((f) => [
        path.join(finished(root), f),
        fs.readFileSync(path.join(finished(root), f), "utf8"),
      ])
  );

const run = <A, E>(effect: Effect.Effect<A, E, NodeContext.NodeContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

const plan = (videos: ReturnType<typeof courseVideo>[]) =>
  run(planExportRenameOnDisk(videos, roots));

/** GC over one Course Version holding `videos`, on the real disk. */
const gc = (videos: ReturnType<typeof courseVideo>[]) => {
  const versionOps = Layer.succeed(VersionOperationsService, {
    getCourseVersions: () => Effect.succeed([{ id: "v1" }]),
    getVersionWithSections: () =>
      Effect.succeed({
        sections: [{ lessons: [{ videos }] }],
      }),
  } as never);
  return Effect.runPromise(
    garbageCollect(COURSE).pipe(
      Effect.provide(
        Layer.mergeAll(
          versionOps,
          // No Exported Animatic on these disks, so GC never reads one.
          Layer.succeed(ClipMockupOperationsService, {} as never),
          NodeContext.layer,
          Layer.setConfigProvider(
            ConfigProvider.fromMap(
              new Map([["STORAGE_ROOTS", roots.join(",")]])
            )
          )
        )
      )
    )
  );
};

describe("export GC before the Exported Video rename", () => {
  it("deletes nothing, though every export is named by the old hash", async () => {
    // The app has the new code; the rename script has not run yet.
    const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
    const old = hashOf(video, []);
    expect(old).not.toBe(hashOf(video, roots));
    put(finished(d), `${COURSE}-${old}.mp4`);
    put(finished(d), `${COURSE}-${old}.mp4.sha256`);
    put(finished(e), `${COURSE}-${old}.mp4`);
    const before = snapshot();

    expect(await gc([video])).toEqual([]);
    expect(snapshot()).toEqual(before);

    // The marker is what holds it back: with it, the very same GC would
    // have deleted every one of those finished videos.
    put(finished(d), EXPORT_HASH_RENAME_MARKER, "{}");
    expect((await gc([video])).length).toBe(3);
  });
});

describe("the Exported Video rename", () => {
  it("a dry run plans the rename and changes nothing", async () => {
    const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
    const old = hashOf(video, []);
    put(finished(d), `${COURSE}-${old}.mp4`);
    const before = snapshot();

    const planned = await plan([video]);

    expect(planned.problems).toEqual([]);
    expect(planned.renames).toEqual([
      {
        from: path.join(finished(d), `${COURSE}-${old}.mp4`),
        to: path.join(finished(d), `${COURSE}-${hashOf(video, roots)}.mp4`),
      },
    ]);
    expect(snapshot()).toEqual(before);
  });

  it("apply renames the export and its digest, then lets GC run without deleting them", async () => {
    const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
    const old = hashOf(video, []);
    const current = hashOf(video, roots);
    put(finished(d), `${COURSE}-${old}.mp4`, "bytes");
    put(finished(d), `${COURSE}-${old}.mp4.sha256`, "digest");
    // On the second root too: GC and the rename see every root.
    const onE = courseVideo(path.join(d, "raw-footage/other.mkv"), "vid-2");
    put(finished(e), `${COURSE}-${hashOf(onE, [])}.mp4`, "e-bytes");

    await run(applyExportRename(await plan([video, onE]), roots));

    expect(snapshot()).toEqual([
      [path.join(finished(d), EXPORT_HASH_RENAME_MARKER), expect.any(String)],
      [path.join(finished(d), `${COURSE}-${current}.mp4`), "bytes"],
      [path.join(finished(d), `${COURSE}-${current}.mp4.sha256`), "digest"],
      [
        path.join(finished(e), `${COURSE}-${hashOf(onE, roots)}.mp4`),
        "e-bytes",
      ],
    ]);
    expect(await gc([video, onE])).toEqual([]);
  });

  it("matches exports whichever order it runs in with the data migration", async () => {
    // The migration ran first: the row is relative now, the file still
    // carries the hash of the absolute path it used to say.
    const before = courseVideo(path.join(d, "raw-footage/take.mkv"));
    const migrated = courseVideo("raw-footage/take.mkv");
    put(finished(d), `${COURSE}-${hashOf(before, [])}.mp4`);

    const planned = await plan([migrated]);

    expect(planned.problems).toEqual([]);
    expect(planned.renames.map((r) => path.basename(r.to))).toEqual([
      `${COURSE}-${hashOf(migrated, roots)}.mp4`,
    ]);
  });

  it("is safe to re-run: a renamed export is already current", async () => {
    const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
    put(finished(d), `${COURSE}-${hashOf(video, [])}.mp4`);
    await run(applyExportRename(await plan([video]), roots));

    const again = await plan([video]);

    expect(again.renames).toEqual([]);
    expect(again.problems).toEqual([]);
    expect(again.alreadyCurrent).toHaveLength(1);
  });

  it("leaves alone exports that are no Course's: a Short's flat file, another namespace", async () => {
    const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
    put(finished(d), `${COURSE}-${hashOf(video, [])}.mp4`);
    put(finished(d), "short-video-id.mp4");
    put(finished(d), "standalone-video-0123456789abcdef0123456789abcdef.mp4");

    const planned = await plan([video]);

    expect(planned.problems).toEqual([]);
    expect(planned.leftAlone.map((f) => path.basename(f))).toEqual([
      "short-video-id.mp4",
      "standalone-video-0123456789abcdef0123456789abcdef.mp4",
    ]);
  });

  describe("aborts with zero changes", () => {
    const expectAbortWithNoChange = async (
      videos: ReturnType<typeof courseVideo>[],
      kind: string
    ) => {
      const before = snapshot();
      const planned = await plan(videos);
      expect(planned.problems.map((p) => p.kind)).toContain(kind);

      const result = await run(
        applyExportRename(planned, roots).pipe(Effect.either)
      );

      expect(Either.isLeft(result)).toBe(true);
      expect(snapshot()).toEqual(before);
      expect(
        fs.existsSync(path.join(finished(d), EXPORT_HASH_RENAME_MARKER))
      ).toBe(false);
    };

    it("when an export named after a Course matches none of its Videos", async () => {
      const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
      put(finished(d), `${COURSE}-${hashOf(video, [])}.mp4`);
      put(finished(d), `${COURSE}-0123456789abcdef0123456789abcdef.mp4`);

      await expectAbortWithNoChange([video], "unmatched");
    });

    it("when the new name already exists", async () => {
      const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
      put(finished(d), `${COURSE}-${hashOf(video, [])}.mp4`, "old");
      // Exported again after the switch, before the rename.
      put(finished(e), `${COURSE}-${hashOf(video, roots)}.mp4`, "new");

      await expectAbortWithNoChange([video], "target-exists");
    });

    it("when two exports would be renamed to the same name", async () => {
      const video = courseVideo(path.join(d, "raw-footage/take.mkv"));
      put(finished(d), `${COURSE}-${hashOf(video, [])}.mp4`);
      put(finished(e), `${COURSE}-${hashOf(video, [])}.mp4`);

      await expectAbortWithNoChange([video], "collision");
    });
  });
});
