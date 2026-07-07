-- One-off script to backfill section titles from the path column before
-- dropping it. Ghost sections (no real lessons) get path copied verbatim.
-- Real sections get the slug portion of path converted to Title Case.
--
-- Run once against the live DB, then `drizzle-kit push` to drop the path
-- column and switch the unique index to (repoVersionId, order).
-- Part of #1207

BEGIN;

-- Ghost sections: copy path verbatim into title.
-- A ghost section has no lessons with fsStatus = 'real'.
UPDATE "course-video-manager_section" s
   SET title = s.path
 WHERE s.title = ''
   AND s.path != ''
   AND NOT EXISTS (
     SELECT 1 FROM "course-video-manager_lesson" l
      WHERE l.section_id = s.id
        AND l.fs_status = 'real'
   );

-- Real sections: strip the leading number prefix (e.g. "01-") from path,
-- then convert the remaining slug to Title Case.
-- initcap handles the capitalisation; replace turns hyphens to spaces first.
UPDATE "course-video-manager_section" s
   SET title = initcap(replace(regexp_replace(s.path, '^\d+-', ''), '-', ' '))
 WHERE s.title = ''
   AND s.path != ''
   AND EXISTS (
     SELECT 1 FROM "course-video-manager_lesson" l
      WHERE l.section_id = s.id
        AND l.fs_status = 'real'
   );

-- Flag: any section still blank after backfill needs manual retitle.
DO $$
DECLARE
  blank_count INTEGER;
BEGIN
  SELECT count(*) INTO blank_count
    FROM "course-video-manager_section"
   WHERE title = ''
     AND archived_at IS NULL;
  IF blank_count > 0 THEN
    RAISE NOTICE '% active section(s) still have blank titles — retitle manually', blank_count;
  END IF;
END $$;

COMMIT;
