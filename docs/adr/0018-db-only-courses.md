---
status: accepted
supersedes: 0016-videos-on-ghost-lessons
---

# Courses are DB-only; retire on-disk repo backing

Courses were originally backed by a local git repo on disk: sections and lessons were folders, structure was parsed from the tree, and Publish wrote sidecar files alongside the videos. We retired that backing entirely (#1207): course structure now lives only in the database, and the CVM CLI replaced the course-editing agent and its virtual filesystem as the day-to-day editing surface.

## What changed

- **Identity moved from path to title.** The `path`, `repo_path`, and `fs_status` columns were dropped from courses, sections, and lessons. A section/lesson is now identified by its `title`, with per-parent uniqueness enforced on `order`; its display path is derived, not stored.
- **The ghost/real distinction is gone.** With no filesystem to be present-or-absent on, every lesson is a plain DB record. The ghost lesson/section/course concepts and the Materialize/Dematerialize machinery were removed — this is why [ADR 0016](0016-videos-on-ghost-lessons.md) is superseded.
- **Publish is DB-derived and video-only.** Publish derives all structure from the DB and its Dropbox output is exclusively `.mp4` files plus a single `course.json` (nodes identified by `title` + lineage `id`, videos located by content-addressed `hash`). Sidecar files (`.transcript.md`, `.body.md`, `.meta.json`, `TODO.md`) and the course-root `changelog.md` are no longer written; the changelog survives only as an in-app preview on the publish screen.

## Why

The dual DB/disk source of truth required constant sync-validation between the database and the on-disk tree, and the on-disk affordances (git push, materialize) became redundant once the CLI covered day-to-day editing. Collapsing to a single source of truth removes that whole class of drift.

## Consequences

- Old on-disk course repos are left inert with their git remotes intact — no user data was touched.
- The `TODO Marker` (`TODO.md` sentinel) is gone, since sidecars are no longer published; lesson-authoring status surfaces only in the app and the changelog.
- Glossary terms CourseRepo, Ghost Lesson/Section/Course, Materialize, Materialization Cascade, and TODO Marker were removed from `CONTEXT.md`.
