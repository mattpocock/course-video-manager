import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pushSchema } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";
import { createBlankDb, type TestDb } from "../test-utils/test-db.js";

const MIGRATIONS_FOLDER = join(import.meta.dirname, "migrations");

/**
 * Each of these creates a fresh database and replays every migration, which is the
 * slowest thing in the suite by an order of magnitude. Vitest's 5s default left
 * no headroom on a loaded machine, so the budget is stated rather than relied on.
 */
const MIGRATION_TIMEOUT_MS = 60_000;

/**
 * A fresh database migrated to just before `tag`: replays a copy of the folder
 * whose journal stops short of it, so a test can seed rows the migration then
 * rewrites when the real folder is run.
 */
async function migrateUpTo(tag: string): ReturnType<typeof createBlankDb> {
  const before = mkdtempSync(join(tmpdir(), "cvm-migrations-"));
  cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
  const journalPath = join(before, "meta/_journal.json");
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(journalPath, "utf-8")
  );
  const cut = journal.entries.findIndex((entry) => entry.tag === tag);
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) })
  );
  const testDb = await createBlankDb();
  await migrate(testDb.db, { migrationsFolder: before });
  rmSync(before, { recursive: true, force: true });
  return testDb;
}

describe("drizzle migrations", () => {
  it(
    "baseline SQL hash matches what readMigrationFiles would compute",
    async () => {
      const journal = JSON.parse(
        readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf-8")
      );
      const baseline = journal.entries[0];
      const sqlContent = readFileSync(
        join(MIGRATIONS_FOLDER, `${baseline.tag}.sql`),
        "utf-8"
      );
      const expectedHash = createHash("sha256")
        .update(sqlContent)
        .digest("hex");

      const { close, db } = await createBlankDb();
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await db.execute<{ hash: string; created_at: string }>(
        sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`
      );

      expect(rows.rows[0]!.hash).toBe(expectedHash);
      expect(Number(rows.rows[0]!.created_at)).toBe(baseline.when);

      await close();
    },
    MIGRATION_TIMEOUT_MS
  );

  /**
   * Every table and column schema.ts declares must be created by a migration.
   * The reverse need not hold: a contract change (the deploy-migration skill)
   * first removes a column from schema.ts and only later drops it in a
   * migration — so between the two, the migrations are ahead.
   */
  it(
    "migrate creates every public-schema column pushSchema does",
    async () => {
      const getPublicColumns = async (db: TestDb) => {
        const result = await db.execute<{
          table_name: string;
          column_name: string;
        }>(
          sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`
        );
        return result.rows.map((r) => `${r.table_name}.${r.column_name}`);
      };

      const { close: closeMigrateDb, db: migrateDb } = await createBlankDb();
      await migrate(migrateDb, { migrationsFolder: MIGRATIONS_FOLDER });
      const migrateColumns = new Set(await getPublicColumns(migrateDb));

      const { close: closePushDb, db: pushDb } = await createBlankDb();
      const { apply } = await pushSchema(schema, pushDb as any);
      await apply();
      const pushColumns = await getPublicColumns(pushDb);

      expect(pushColumns.length).toBeGreaterThan(0);
      expect(pushColumns.filter((c) => !migrateColumns.has(c))).toEqual([]);

      await closeMigrateDb();
      await closePushDb();
    },
    MIGRATION_TIMEOUT_MS
  );

  /**
   * drizzle's migrator applies only the migrations whose `when` is newer than
   * the newest one already recorded, so a migration that lands with an older
   * `when` than one a database has already run is skipped there forever,
   * silently. That is how 0004_video_format_landscape never reached
   * production (see 0027_video_format_repair). Regenerate the migration on
   * top of main rather than keeping a stale `when` through a rebase.
   */
  it("every migration's `when` is later than the one before it", () => {
    const journal: { entries: { tag: string; when: number }[] } = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf-8")
    );
    // 0007 and 0008 were applied in the same `migrate` run, which reads the
    // newest recorded `when` once up front, so the inversion was harmless.
    const knownInversions = new Set(["0008_add_video_script"]);

    const outOfOrder = journal.entries
      .filter((entry, i) => i > 0 && entry.when <= journal.entries[i - 1]!.when)
      .map((entry) => entry.tag)
      .filter((tag) => !knownInversions.has(tag));

    expect(outOfOrder).toEqual([]);
  });

  it(
    "0028 backfills each Clip's Transcription status from what it already had",
    async () => {
      // Migrate to just before 0028, seed the Clips, then run the real folder
      // for 0028.
      const { close, db } = await migrateUpTo("0028_clip_transcription_status");

      // Clip rows only: the Video they point at is beside the point here.
      await db.execute(sql`SET session_replication_role = replica`);
      await db.execute(sql`
        INSERT INTO "course-video-manager_clip"
          (id, video_id, video_filename, source_start_time, source_end_time, "order", text, transcribed_at)
        VALUES
          ('transcribed', 'v', 'f.mp4', 0, 1, 'a', 'hello', now()),
          ('heard-nothing', 'v', 'f.mp4', 0, 1, 'b', '', now()),
          ('text-no-timestamp', 'v', 'f.mp4', 0, 1, 'c', 'from footage', NULL),
          ('never-transcribed', 'v', 'f.mp4', 0, 1, 'd', '', NULL)
      `);
      await db.execute(sql`SET session_replication_role = DEFAULT`);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await db.execute<{ id: string; status: string }>(
        sql`SELECT id, transcription_status AS status FROM "course-video-manager_clip" ORDER BY "order"`
      );
      expect(rows.rows).toEqual([
        { id: "transcribed", status: "done" },
        { id: "heard-nothing", status: "done" },
        { id: "text-no-timestamp", status: "done" },
        { id: "never-transcribed", status: "failed" },
      ]);

      await close();
    },
    MIGRATION_TIMEOUT_MS
  );

  it(
    "0033 renames the New recorder's stored value to `cvm` and refuses the old one",
    async () => {
      const { close, db } = await migrateUpTo("0033_video_recorder_cvm");

      await db.execute(sql`
        INSERT INTO "course-video-manager_video"
          (id, lineage_id, title, original_footage_path, recorder)
        VALUES
          ('cvm-video', 'l1', 'CVM', '', 'new-recorder'),
          ('obs-video', 'l2', 'OBS', '', 'obs'),
          ('unset-video', 'l3', 'Unset', '', NULL)
      `);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await db.execute<{ id: string; recorder: string | null }>(
        sql`SELECT id, recorder FROM "course-video-manager_video" ORDER BY lineage_id`
      );
      expect(rows.rows).toEqual([
        { id: "cvm-video", recorder: "cvm" },
        { id: "obs-video", recorder: "obs" },
        { id: "unset-video", recorder: null },
      ]);
      await expect(
        db.execute(
          sql`UPDATE "course-video-manager_video" SET recorder = 'new-recorder' WHERE id = 'obs-video'`
        )
      ).rejects.toThrow();

      await close();
    },
    MIGRATION_TIMEOUT_MS
  );
  /**
   * The picture a B-roll drew, read back from its Footage Layers: at a moment
   * `t` of the Video (on the timeline the export placed Overlays on), the
   * instant of which Footage file is on screen, or null for the Scene Layer.
   */
  const footageAt = (
    layers: {
      clip_id: string;
      footage_path: string;
      footage_start: number;
      span_at: number;
      span_duration: number;
    }[],
    clipStarts: Record<string, number>,
    t: number
  ) => {
    for (const layer of layers) {
      const at = clipStarts[layer.clip_id]! + layer.span_at;
      if (t >= at && t < at + layer.span_duration) {
        return {
          path: layer.footage_path,
          instant: layer.footage_start + (t - at),
        };
      }
    }
    return null;
  };

  it(
    "0049 turns each B-roll into Footage Layers showing the same Footage at the same Video times",
    async () => {
      const { close, db } = await migrateUpTo("0049_b_roll_to_footage_layers");

      await db.execute(sql`
        INSERT INTO "course-video-manager_video"
          (id, lineage_id, title, original_footage_path, format)
        VALUES ('one', 'l1', 'One', '', 'landscape'), ('two', 'l2', 'Two', '', 'landscape')
      `);
      // Video one: a (10 s), then b (4 s + a long Pause), then c (5 s + the
      // final padding). Video two: x (3 s), an archived Clip, y (2 s + a long
      // Pause), z (1 s + the final padding).
      await db.execute(sql`
        INSERT INTO "course-video-manager_clip"
          (id, video_id, video_filename, source_start_time, source_end_time, "order", text, archived, pause_type)
        VALUES
          ('a', 'one', 'f.mp4', 0, 10, 'a', '', false, 'none'),
          ('b', 'one', 'f.mp4', 20, 24, 'b', '', false, 'long'),
          ('c', 'one', 'f.mp4', 0, 5, 'c', '', false, 'none'),
          ('x', 'two', 'f.mp4', 0, 3, 'a', '', false, 'none'),
          ('gone', 'two', 'f.mp4', 0, 50, 'b', '', true, 'none'),
          ('y', 'two', 'f.mp4', 10, 12, 'c', '', false, 'long'),
          ('z', 'two', 'f.mp4', 5, 6, 'd', '', false, 'none')
      `);
      await db.execute(sql`
        INSERT INTO "course-video-manager_overlay"
          (id, clip_id, at, duration_in_seconds, kind, title, description, footage_path, footage_start)
        VALUES
          ('part', 'a', 2, 3, 'bRoll', '', '', 'raw-footage/imported/part.mp4', 10),
          ('whole', 'b', 0, 4.18, 'bRoll', '', '', 'raw-footage/imported/whole.mp4', 7),
          ('card', 'c', 1, 2, 'definitionCard', 'Term', 'Body', NULL, NULL),
          ('several', 'x', 2, 10, 'bRoll', '', '', 'raw-footage/imported/several.mp4', 1),
          ('archived', 'gone', 1, 2, 'bRoll', '', '', 'raw-footage/imported/never.mp4', 0)
      `);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const overlays = await db.execute<{ id: string }>(
        sql`SELECT id FROM "course-video-manager_overlay" ORDER BY id`
      );
      expect(overlays.rows).toEqual([{ id: "card" }]);

      const rows = (
        await db.execute<{
          clip_id: string;
          position: number;
          kind: string;
          footage_path: string;
          footage_start: number;
          crop: number[];
          place: number[];
          volume: number;
          span_at: number;
          span_duration: number;
        }>(sql`
          SELECT clip_id, position, kind, footage_path, footage_start,
            ARRAY[crop_x, crop_y, crop_w, crop_h] AS crop,
            ARRAY[place_x, place_y, place_w, place_h] AS place,
            volume, span_at, span_duration
          FROM "course-video-manager_clip_layer" ORDER BY clip_id, position
        `)
      ).rows;
      // A Scene Layer at the bottom of every Clip a B-roll covered, and a
      // full-frame, muted Footage Layer above it.
      expect(rows.map((r) => [r.clip_id, r.position, r.kind])).toEqual([
        ["a", 0, "scene"],
        ["a", 1, "footage"],
        ["b", 0, "scene"],
        ["b", 1, "footage"],
        ["x", 0, "scene"],
        ["x", 1, "footage"],
        ["y", 0, "scene"],
        ["y", 1, "footage"],
        ["z", 0, "scene"],
        ["z", 1, "footage"],
      ]);
      const footage = rows.filter((r) => r.kind === "footage");
      for (const layer of footage) {
        expect(layer.crop).toEqual([0, 0, 1, 1]);
        expect(layer.place).toEqual([0, 0, 1920, 1080]);
        expect(layer.volume).toBe(0);
      }
      const spans = Object.fromEntries(
        footage.map((r) => [
          r.clip_id,
          [r.footage_start, r.span_at, r.span_duration].map((n) =>
            Number(n.toFixed(6))
          ),
        ])
      );
      expect(spans).toEqual({
        // Part of one Clip.
        a: [10, 2, 3],
        // A whole Clip, its long Pause included.
        b: [7, 0, 4.18],
        // Several Clips, the archived one skipped, cut at the Video's end.
        x: [1, 2, 1],
        y: [2, 0, 2.18],
        z: [4.18, 0, 1.42],
      });

      // Each B-roll's picture, sampled across its window and either side of
      // it: before, the Footage instant `from + (t - window start)`; after,
      // the same instant from the Footage Layers.
      const bRolls: {
        clipStarts: Record<string, number>;
        path: string;
        from: number;
        start: number;
        end: number;
      }[] = [
        {
          clipStarts: { a: 0, b: 10, c: 14.18 },
          path: "part",
          from: 10,
          start: 2,
          end: 5,
        },
        {
          clipStarts: { a: 0, b: 10, c: 14.18 },
          path: "whole",
          from: 7,
          start: 10,
          end: 14.18,
        },
        {
          clipStarts: { x: 0, y: 3, z: 5.18 },
          path: "several",
          from: 1,
          start: 2,
          end: 6.6,
        },
      ];
      for (const bRoll of bRolls) {
        const layers = footage.filter((r) => r.clip_id in bRoll.clipStarts);
        for (let t = bRoll.start - 0.5; t < bRoll.end + 0.5; t += 1 / 60) {
          const shown = footageAt(layers, bRoll.clipStarts, t);
          const inWindow = t >= bRoll.start && t < bRoll.end - 1e-9;
          if (!inWindow) {
            if (t < bRoll.start - 1e-9 || t > bRoll.end + 1e-9) {
              expect(shown?.path.includes(bRoll.path) ?? false).toBe(false);
            }
            continue;
          }
          expect(shown?.path).toBe(`raw-footage/imported/${bRoll.path}.mp4`);
          expect(shown!.instant).toBeCloseTo(bRoll.from + (t - bRoll.start), 9);
        }
      }

      await close();
    },
    MIGRATION_TIMEOUT_MS
  );
});
