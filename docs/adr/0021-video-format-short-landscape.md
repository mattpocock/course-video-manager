---
status: accepted
---

# Model the short-vs-long axis as `video.format` with values `short` | `landscape`

Every **Video** carries a **Video Format**: the text column `video.format`, one
of two values — `short` (a vertical, short-form video) or `landscape` (a
horizontal, long-form video, the default). This replaces the previous value
`standard`, which is renamed to `landscape`.

## Decision

- The short-vs-long distinction is a single text column, `video.format`, not a
  boolean or a separate table. Values are `short` and `landscape`; the column
  defaults to `landscape`.
- **"Short"** is the canonical name everywhere, including in the implementation
  (`format: "short"`, the `/shorts` route, the sidebar "Shorts" item).
- **"Landscape"** is the canonical name for the long-form default. It was chosen
  because it is how the owner describes long-form videos.

## Why not "standard" or "tiktok"

- **"standard"** (the old value) is vague — it names the default by its
  defaultness, not by what it is. "Landscape" describes the actual shape/format
  and reads naturally against "Short".
- **"TikTok"** is reserved for the actual TikTok platform: the OBS recording
  profile (`OBS_PROFILE_TIKTOK = "TikTok"`) and the Buffer posting destinations
  ("Post to TikTok via Buffer"). Using "TikTok" as the format name would conflate
  the platform with the format. A Short may be posted to YouTube Shorts, TikTok,
  X, Bluesky, etc. — the format is not the destination.

## Standalone is orthogonal

**Video Format** is a SEPARATE axis from **Standalone** (`lessonId = NULL`). A
Standalone video may be either Landscape or Short; every Short is Standalone, but
the two concepts must not be conflated. "Standalone" is never used to mean a
format.

## Migration

Migration `0004_video_format_landscape.sql` sets the column default to
`'landscape'` and renames existing rows:
`UPDATE "course-video-manager_video" SET "format" = 'landscape' WHERE "format" = 'standard';`

## Consequences

- Type/constant family: `VIDEO_FORMATS = ["landscape", "short"]`, `VideoFormat`,
  `DEFAULT_VIDEO_FORMAT = "landscape"`, `VIDEO_FORMAT_LABELS`.
- The UI grid of Shorts lives at `/shorts` (renamed from `/tiktoks`); Landscape
  videos are under `/videos`.
- The `cvm video` CLI reads `format`, filters `list --format <landscape|short>`,
  and writes it on `create --format` / `update --format`. Setting format via
  `update` calls `updateVideoFormat`, which also NULLs `lessonId` (a Short is
  always Standalone), and moves each Clip's Footage Layers into the new frame
  (Placement by fractions, Source Crop narrowed to the box's new aspect; #2608).
- Genuine TikTok-the-platform references (OBS profile, Buffer labels) are left
  unchanged.
