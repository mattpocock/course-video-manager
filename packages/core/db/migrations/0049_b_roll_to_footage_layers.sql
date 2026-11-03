-- Every B-roll Overlay becomes Footage Layers (ADR 0056), then the B-roll
-- Overlays are deleted. Data only: the Overlay's footage_path/footage_start
-- columns stay until a follow-up drops them (contract first, the
-- deploy-migration skill), so the code still serving keeps reading them.
--
-- The B-roll's window is placed on its Video's timeline exactly as the
-- export placed it (`placeOnTimeline`): the live Clips end to end in `order`,
-- each lasting its source span, plus 0.18 s for a long Pause
-- (LONG_PAUSE_DURATION_IN_SECONDS), plus 0.42 s on the last Clip
-- (FINAL_VIDEO_PADDING), and the window cut at the Video's end. Each Clip the
-- window covers gets one Footage Layer spanning the part it covers, whose
-- start is the B-roll's `from` carried on by how far into the window that
-- Clip begins. So every Clip shows the same Footage frame at the same moment
-- of itself as before. Full frame (Source Crop the whole frame, Placement the
-- Video's frame), muted, as a B-roll was. A Clip with no Layers yet gets its
-- Scene Layer at position 0 first: on a Landscape Video the Footage Layers go
-- above it. A B-roll on an archived Clip, past the Video's end, or with no
-- Footage was never drawn, and is only deleted.
CREATE TEMP TABLE "b_roll_piece" AS
WITH "live" AS (
  SELECT c."id", c."video_id", c."order",
    (c."source_end_time" - c."source_start_time")
      + CASE WHEN c."pause_type" = 'long' THEN 0.18 ELSE 0 END
      + CASE WHEN ROW_NUMBER() OVER (PARTITION BY c."video_id" ORDER BY c."order" COLLATE "C" DESC) = 1 THEN 0.42 ELSE 0 END AS "length"
  FROM "course-video-manager_clip" c
  WHERE c."archived" = false
), "placed" AS (
  SELECT "id", "video_id", "length",
    SUM("length") OVER (PARTITION BY "video_id" ORDER BY "order" COLLATE "C" ROWS UNBOUNDED PRECEDING) - "length" AS "clip_start",
    SUM("length") OVER (PARTITION BY "video_id") AS "video_end"
  FROM "live"
), "b_roll_window" AS (
  SELECT o."id" AS "overlay_id", p."video_id", o."footage_path",
    COALESCE(o."footage_start", 0) AS "footage_start",
    p."clip_start" + o."at" AS "window_start",
    LEAST(p."clip_start" + o."at" + o."duration_in_seconds", p."video_end") AS "window_end"
  FROM "course-video-manager_overlay" o
  JOIN "placed" p ON p."id" = o."clip_id"
  WHERE o."kind" = 'bRoll' AND o."footage_path" IS NOT NULL
)
SELECT p."id" AS "clip_id", w."overlay_id", w."footage_path",
  GREATEST(w."window_start", p."clip_start") AS "piece_start",
  w."footage_start" + (GREATEST(w."window_start", p."clip_start") - w."window_start") AS "footage_start",
  GREATEST(w."window_start", p."clip_start") - p."clip_start" AS "span_at",
  LEAST(w."window_end", p."clip_start" + p."length") - GREATEST(w."window_start", p."clip_start") AS "span_duration"
FROM "b_roll_window" w
JOIN "placed" p ON p."video_id" = w."video_id"
WHERE LEAST(w."window_end", p."clip_start" + p."length") > GREATEST(w."window_start", p."clip_start");--> statement-breakpoint
INSERT INTO "course-video-manager_clip_layer" ("id", "clip_id", "position", "kind", "volume")
SELECT gen_random_uuid()::text, "clip_id", 0, 'scene', 1
FROM (SELECT DISTINCT "clip_id" FROM "b_roll_piece") pieces
WHERE NOT EXISTS (
  SELECT 1 FROM "course-video-manager_clip_layer" l WHERE l."clip_id" = pieces."clip_id"
);--> statement-breakpoint
INSERT INTO "course-video-manager_clip_layer" (
  "id", "clip_id", "position", "kind", "footage_path", "footage_start",
  "crop_x", "crop_y", "crop_w", "crop_h",
  "place_x", "place_y", "place_w", "place_h",
  "volume", "span_at", "span_duration"
)
SELECT gen_random_uuid()::text, b."clip_id",
  (SELECT MAX(l."position") FROM "course-video-manager_clip_layer" l WHERE l."clip_id" = b."clip_id")
    + ROW_NUMBER() OVER (PARTITION BY b."clip_id" ORDER BY b."piece_start", b."overlay_id"),
  'footage', b."footage_path", b."footage_start",
  0, 0, 1, 1,
  0, 0,
  CASE WHEN v."format" = 'short' THEN 1080 ELSE 1920 END,
  CASE WHEN v."format" = 'short' THEN 1920 ELSE 1080 END,
  0, b."span_at", b."span_duration"
FROM "b_roll_piece" b
JOIN "course-video-manager_clip" c ON c."id" = b."clip_id"
JOIN "course-video-manager_video" v ON v."id" = c."video_id";--> statement-breakpoint
DELETE FROM "course-video-manager_overlay" WHERE "kind" = 'bRoll';--> statement-breakpoint
DROP TABLE "b_roll_piece";
