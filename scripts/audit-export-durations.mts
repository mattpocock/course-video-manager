/**
 * Find silently TRUNCATED Exported Videos.
 *
 * An Export Hash names what the renderer was ASKED to do, never what it
 * actually produced, and nothing in the export pipeline compares the two. An
 * ffmpeg run that ends early therefore exits 0 and leaves a short `.mp4` at a
 * perfectly valid export address, which the next Publish ships.
 *
 * This walks every Exported Video of one Course that is on this disk and
 * reports any whose real duration disagrees with the duration its Clips ask
 * for. Read-only: it opens the database and reads files, and writes nothing.
 *
 *   cd apps/local
 *   DATABASE_URL=... npx tsx ../../scripts/audit-export-durations.mts <courseId>
 *
 * It runs from `apps/local` because that is where `pg` is installed, and
 * because the `@/` alias in the modules below resolves against that tsconfig.
 *
 * The export address and the expected duration are IMPORTED, never restated
 * here. This script's whole worth is that it agrees with the Publish about
 * which file a Video lives in and how long that file should play for; a second
 * copy of either rule would drift and start reporting fiction.
 */
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  computeExportHash,
  resolveExportPath,
} from "../apps/local/app/services/export-hash.js";
import {
  expectedExportDurationInSeconds,
  paddedClipDurationsInSeconds,
} from "../apps/local/app/services/export-duration-check.js";

const FINISHED =
  process.env.FINISHED_VIDEOS_DIRECTORY ?? "/mnt/d/finished-videos";
const COURSE = process.argv[2]!;

const hashOf = (clips: any[], format: string | null) =>
  computeExportHash(
    clips.map((c) => ({
      videoFilename: c.video_filename,
      sourceStartTime: c.source_start_time,
      sourceEndTime: c.source_end_time,
      pauseType: c.pause_type,
      zoomType: c.zoom_type,
    })),
    format
  );

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
  `select v.id as video_id, v.title, v.format,
          cv.name as version_name, cv.commit_state, cv.created_at as version_created,
          l."order" as lesson_order, s."order" as section_order,
          c.video_filename, c.source_start_time, c.source_end_time,
          c.pause_type, c.zoom_type, c."order" as clip_order
   from "course-video-manager_video" v
   join "course-video-manager_lesson" l on l.id = v.lesson_id
   join "course-video-manager_section" s on s.id = l.section_id
   join "course-video-manager_course_version" cv on cv.id = s.course_version_id
   left join "course-video-manager_clip" c
     on c.video_id = v.id and c.archived = false
   where cv.course_id = $1 and v.archived = false
   order by cv.created_at, s."order", l."order", c."order"`,
  [COURSE]
);

const byVideo = new Map<string, any[]>();
const meta = new Map<string, any>();
for (const r of rows) {
  meta.set(r.video_id, r);
  if (!r.video_filename) continue;
  const list = byVideo.get(r.video_id) ?? [];
  list.push(r);
  byVideo.set(r.video_id, list);
}

const probe = (file: string) =>
  Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ])
      .toString()
      .trim()
  );

let checked = 0;
const seen = new Set<string>();
for (const [videoId, clips] of byVideo) {
  const m = meta.get(videoId);
  const hash = hashOf(clips, m.format);
  if (!hash || seen.has(hash)) continue;
  seen.add(hash);
  const file = resolveExportPath(FINISHED, COURSE, hash);
  if (!fs.existsSync(file)) continue;
  checked++;
  const expected = expectedExportDurationInSeconds(
    paddedClipDurationsInSeconds(
      clips.map((c) => ({
        sourceStartTime: c.source_start_time,
        sourceEndTime: c.source_end_time,
        pauseType: c.pause_type,
      }))
    )
  );
  const actual = probe(file);
  const drift = actual - expected;
  if (Math.abs(drift) > 1) {
    console.log(
      `DRIFT ${drift.toFixed(1)}s  expected=${expected.toFixed(1)} actual=${actual.toFixed(1)}  "${m.title}" (${m.version_name}/${m.commit_state}) ${path.basename(file)}`
    );
  }
}
console.log(`\nchecked ${checked} exports of course ${COURSE}`);
await client.end();
