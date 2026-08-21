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
 * It runs from `apps/local` because that is where `pg` is installed.
 */
import { Client } from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const FINISHED =
  process.env.FINISHED_VIDEOS_DIRECTORY ?? "/mnt/d/finished-videos";
const COURSE = process.argv[2]!;
const EXPORT_VERSION = 1;
const LONG_PAUSE_DURATION = 0.18;
const FINAL_VIDEO_PADDING = 0.5 - 0.08;

const hashOf = (clips: any[], format: string | null) => {
  if (clips.length === 0) return null;
  const payload = {
    v: EXPORT_VERSION,
    fmt: format === "short" ? "short" : "landscape",
    clips: clips.map((c) => ({
      f: c.video_filename,
      s: c.source_start_time,
      e: c.source_end_time,
      ...(c.pause_type === "long" ? { p: "long" } : {}),
      ...(c.zoom_type && c.zoom_type !== "none" ? { z: c.zoom_type } : {}),
    })),
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);
};

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
  const file = path.join(FINISHED, `${COURSE}-${hash}.mp4`);
  if (!fs.existsSync(file)) continue;
  checked++;
  const expected =
    clips.reduce(
      (sum, c) =>
        sum +
        (c.source_end_time - c.source_start_time) +
        (c.pause_type === "long" ? LONG_PAUSE_DURATION : 0),
      0
    ) + FINAL_VIDEO_PADDING;
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
