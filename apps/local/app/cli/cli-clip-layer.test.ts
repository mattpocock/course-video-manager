import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import { LOCAL_MACHINE_ENV_KEY } from "./env";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  type RunResult,
} from "./cli-write-test-harness";

// cvm clip layer list|add|update|move|remove and clip update --layers-from.
// Flags go BEFORE the trailing positionals.

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  run = makeRun(buildWriteLayer(testDb));
});

let root: string;
beforeEach(async () => {
  await truncateAllTables(testDb);
  root = mkdtempSync(join(tmpdir(), "cvm-clip-layer-"));
  mkdirSync(join(root, "raw-footage/imported"), { recursive: true });
  writeFileSync(join(root, "raw-footage/imported/city.mp4"), "x");
  process.env.STORAGE_ROOTS = root;
  process.env[LOCAL_MACHINE_ENV_KEY] = "true";
  return () => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.STORAGE_ROOTS;
    delete process.env[LOCAL_MACHINE_ENV_KEY];
  };
});

afterAll(() => {
  delete process.env.STORAGE_ROOTS;
});

/**
 * A standalone Video of `format` with two Clips cut from one Landscape
 * stream Recording Session, and an OBS Clip with none.
 */
const seed = async (format: "short" | "landscape") => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: `${format}.mp4`, originalFootagePath: "f.mp4", format })
    .returning();
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video!.id,
      cameraFilePath: "/rec/s1/camera.mkv",
      screenFilePath: "/rec/s1/screen.mkv",
      micFilePath: "/rec/s1/mic.mkv",
      status: "stopped",
    })
    .returning();
  const clip = async (order: string, recordingSessionId: string | null) => {
    const [row] = await testDb
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: recordingSessionId ? "/rec/s1/mic.mkv" : "obs.mkv",
        sourceStartTime: 1,
        sourceEndTime: 5,
        order,
        text: "hello",
        recordingSessionId,
      })
      .returning();
    return row!.id;
  };
  return {
    videoId: video!.id,
    first: await clip("a0", session!.id),
    second: await clip("a1", session!.id),
    obs: await clip("a2", null),
  };
};

const layers = async (clipId: string) =>
  ndjson((await run(["clip", "layer", "list", clipId])).stdout);

const SCREEN_SQUARE = [
  "--footage",
  "screen",
  "--crop",
  "0,0,0.5625,1",
  "--place",
  "0,0,1080,1080",
];
const FACE_BAND = [
  "--footage",
  "camera",
  "--crop",
  "0.14,0,0.72,1",
  "--place",
  "0,1080,1080,840",
];

const UNTOUCHED = [{ index: 0, kind: "scene", volume: 1 }];

describe("cvm clip layer", () => {
  it("lists an untouched Clip as one Scene Layer, and stores nothing for it", async () => {
    const s = await seed("short");
    expect(await layers(s.first)).toEqual(UNTOUCHED);
    expect(await testDb.query.clipLayers.findMany()).toEqual([]);
  });

  it("composes a Short frame from the Clip's own screen and camera, then drops the Scene Layer", async () => {
    const s = await seed("short");
    expect(
      (await run(["clip", "layer", "add", ...SCREEN_SQUARE, s.first])).exitCode
    ).toBe(0);
    await run(["clip", "layer", "add", ...FACE_BAND, s.first]);
    const removed = await run(["clip", "layer", "remove", s.first, "0"]);

    expect(removed.exitCode).toBe(0);
    expect(ndjson(removed.stdout)).toEqual([
      {
        index: 0,
        kind: "footage",
        source: { kind: "session", file: "screen" },
        sourceCrop: { x: 0, y: 0, w: 0.5625, h: 1 },
        placement: { x: 0, y: 0, w: 1080, h: 1080 },
        volume: 0,
        span: null,
      },
      {
        index: 1,
        kind: "footage",
        source: { kind: "session", file: "camera" },
        sourceCrop: { x: 0.14, y: 0, w: 0.72, h: 1 },
        placement: { x: 0, y: 1080, w: 1080, h: 840 },
        volume: 0,
        span: null,
      },
    ]);
    expect(await layers(s.first)).toEqual(ndjson(removed.stdout));
  });

  it("adds a Footage file root-relative over the whole frame, muted, by default", async () => {
    const s = await seed("landscape");
    const added = await run([
      "clip",
      "layer",
      "add",
      "--footage",
      join(root, "raw-footage/imported/city.mp4"),
      s.obs,
    ]);
    expect(added.exitCode).toBe(0);
    expect(ndjson(added.stdout)).toEqual([
      ...UNTOUCHED,
      {
        index: 1,
        kind: "footage",
        source: {
          kind: "file",
          path: "raw-footage/imported/city.mp4",
          start: 0,
        },
        sourceCrop: { x: 0, y: 0, w: 1, h: 1 },
        placement: { x: 0, y: 0, w: 1920, h: 1080 },
        volume: 0,
        span: null,
      },
    ]);
  });

  it("updates a Layer's fields and keeps the rest, and moves it", async () => {
    const s = await seed("short");
    await run(["clip", "layer", "add", ...SCREEN_SQUARE, s.first]);
    const updated = await run([
      "clip",
      "layer",
      "update",
      "--volume",
      "0.5",
      "--at",
      "1",
      "--duration",
      "2",
      s.first,
      "1",
    ]);
    expect(updated.exitCode).toBe(0);
    expect(ndjson(updated.stdout)[1]).toMatchObject({
      source: { kind: "session", file: "screen" },
      placement: { x: 0, y: 0, w: 1080, h: 1080 },
      volume: 0.5,
      span: { at: 1, duration: 2 },
    });

    const moved = await run([
      "clip",
      "layer",
      "move",
      "--to",
      "0",
      s.first,
      "1",
    ]);
    expect(
      ndjson(moved.stdout).map((l) => (l as { kind: string }).kind)
    ).toEqual(["footage", "scene"]);
  });

  it("reads back as untouched once only a full-volume Scene Layer is left", async () => {
    const s = await seed("landscape");
    await run(["clip", "layer", "add", ...FACE_BAND, s.first]);
    await run(["clip", "layer", "remove", s.first, "1"]);
    expect(await layers(s.first)).toEqual(UNTOUCHED);
    expect(await testDb.query.clipLayers.findMany()).toEqual([]);
  });

  it("copies one Clip's Layers onto others with --layers-from, linking nothing", async () => {
    const s = await seed("short");
    await run(["clip", "layer", "add", ...SCREEN_SQUARE, s.first]);
    const copied = await run([
      "clip",
      "update",
      "--layers-from",
      s.first,
      s.second,
    ]);
    expect(copied.exitCode).toBe(0);
    expect(await layers(s.second)).toEqual(await layers(s.first));

    await run(["clip", "layer", "remove", s.first, "1"]);
    expect(await layers(s.first)).toEqual(UNTOUCHED);
    expect(await layers(s.second)).toHaveLength(2);
  });

  it("keeps a Footage file's Layer on the same Footage moment when its Clip is retimed", async () => {
    const s = await seed("landscape");
    await run([
      "clip",
      "layer",
      "add",
      "--footage",
      join(root, "raw-footage/imported/city.mp4"),
      "--from",
      "10",
      "--at",
      "2",
      "--duration",
      "1",
      s.obs,
    ]);
    // 1 -> 5 recut to 1.5 -> 5: the span moves 0.5 s earlier into the Clip.
    await run(["clip", "update", "--start", "1.5", s.obs]);
    expect((await layers(s.obs))[1]).toMatchObject({
      source: { kind: "file", start: 10 },
      span: { at: 1.5, duration: 1 },
    });
  });

  it("refuses a write over Layers another command changed since it read them (exit 8), losing neither", async () => {
    const s = await seed("short");
    // The other command lands between this one's read and its write.
    let raced = false;
    const racing = makeRun(
      buildWriteLayer(testDb, {
        beforeRequest: async (url) => {
          if (raced || !url.endsWith("/setClipLayers")) return;
          raced = true;
          await run(["clip", "layer", "add", ...FACE_BAND, s.first]);
        },
      })
    );

    const lost = await racing([
      "clip",
      "layer",
      "add",
      ...SCREEN_SQUARE,
      s.first,
    ]);

    expect(lost.exitCode).toBe(8);
    expect(JSON.parse(lost.stderr)).toMatchObject({
      _tag: "ClipLayersChangedError",
      clipId: s.first,
    });
    const afterRace = [
      { index: 0, kind: "scene", volume: 1 },
      expect.objectContaining({
        index: 1,
        source: { kind: "session", file: "camera" },
      }),
    ];
    expect(await layers(s.first)).toEqual(afterRace);

    // Run again, it reads the other command's Layer and keeps it.
    const retried = await run([
      "clip",
      "layer",
      "add",
      ...SCREEN_SQUARE,
      s.first,
    ]);
    expect(retried.exitCode).toBe(0);
    expect(ndjson(retried.stdout)).toEqual([
      ...afterRace,
      expect.objectContaining({
        index: 2,
        source: { kind: "session", file: "screen" },
      }),
    ]);
  });

  describe("refuses with exit 3, writing nothing", () => {
    const refused = async (clipId: string, argv: string[]) => {
      const before = await layers(clipId);
      const result = await run(argv);
      expect(result.exitCode).toBe(3);
      expect(await layers(clipId)).toEqual(before);
      return result.stderr;
    };

    it("a Source Crop outside 0-1", async () => {
      const s = await seed("short");
      expect(
        await refused(s.first, [
          "clip",
          "layer",
          "add",
          "--footage",
          "screen",
          "--crop",
          "0.5,0,0.6,1",
          s.first,
        ])
      ).toContain("Source Crop");
    });

    it("a Placement with no area", async () => {
      const s = await seed("short");
      expect(
        await refused(s.first, [
          "clip",
          "layer",
          "add",
          "--footage",
          "screen",
          "--place",
          "0,0,1080,0",
          s.first,
        ])
      ).toContain("no area");
    });

    it("an unknown Footage path", async () => {
      const s = await seed("short");
      expect(
        await refused(s.first, [
          "clip",
          "layer",
          "add",
          "--footage",
          "raw-footage/imported/missing.mp4",
          s.first,
        ])
      ).toContain("no such Footage");
    });

    it("camera or screen on a Clip with no Recording Session, also through --layers-from", async () => {
      const s = await seed("short");
      expect(
        await refused(s.obs, [
          "clip",
          "layer",
          "add",
          "--footage",
          "camera",
          s.obs,
        ])
      ).toContain("no Recording Session");
      await run(["clip", "layer", "add", ...FACE_BAND, s.first]);
      await refused(s.obs, [
        "clip",
        "update",
        "--layers-from",
        s.first,
        s.second,
        s.obs,
      ]);
      expect(await layers(s.second)).toEqual(UNTOUCHED);
    });

    it("a Landscape shape other than a Scene Layer at the bottom", async () => {
      const s = await seed("landscape");
      await run(["clip", "layer", "add", ...FACE_BAND, s.first]);
      expect(
        await refused(s.first, ["clip", "layer", "remove", s.first, "0"])
      ).toContain("Landscape");
      await refused(s.first, [
        "clip",
        "layer",
        "move",
        "--to",
        "0",
        s.first,
        "1",
      ]);
    });

    it("a Clip whose Version is not a Draft", async () => {
      const [course] = await testDb
        .insert(schema.courses)
        .values({ name: "Shipped", slug: "shipped" })
        .returning();
      const [version] = await testDb
        .insert(schema.courseVersions)
        .values({ repoId: course!.id, name: "v1", commitState: "published" })
        .returning();
      const [section] = await testDb
        .insert(schema.sections)
        .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
        .returning();
      const [lesson] = await testDb
        .insert(schema.lessons)
        .values({ sectionId: section!.id, title: "Welcome", order: 1 })
        .returning();
      const [video] = await testDb
        .insert(schema.videos)
        .values({
          lessonId: lesson!.id,
          title: "intro.mp4",
          originalFootagePath: "f.mp4",
        })
        .returning();
      const [clip] = await testDb
        .insert(schema.clips)
        .values({
          videoId: video!.id,
          videoFilename: "a.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
          order: "a0",
          text: "hello",
        })
        .returning();
      expect(
        await refused(clip!.id, [
          "clip",
          "layer",
          "add",
          "--footage",
          join(root, "raw-footage/imported/city.mp4"),
          clip!.id,
        ])
      ).toMatch(/draft/i);
    });
  });
});
