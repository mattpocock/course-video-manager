---
status: superseded
---

# Publishing TODO lessons

> **Superseded (2026-07-10).** This ADR does not reflect the code. The per-lesson
> `TODO.md` sentinel it describes (the **TODO Marker**) was never implemented — no
> code writes such a file (the only file write in the publish path is `course.json`),
> and the changelog legend's reference to a `TODO.md` sentinel is stale. The one real
> signal is the changelog itself: the `(TODO)` suffix on **New Lessons** plus the
> **Marked Ready** / **Marked TODO** buckets. TODO lessons are otherwise mirrored to
> Dropbox identically to `done` lessons. A replacement decision — a publish-time filter
> to include or withhold TODO lessons — is being designed and will supersede this.

A real **Lesson** whose **Lesson Authoring Status** is `todo` is published into Dropbox normally — its directory is created, and any videos, transcripts, and source files it already has are mirrored exactly as for a `done` lesson. The TODO state is communicated via two additive signals: a per-lesson `TODO.md` sentinel file written inside the lesson's dropbox folder (the **TODO Marker**), and per-section **Marked Ready** / **Marked TODO** buckets in `changelog.md` tracking status transitions across **Published Versions** via lesson lineage (`previousVersionLessonId`). New lessons that arrive in `todo` state are listed in the existing **New Lessons** bucket with a `(TODO)` suffix. The sentinel content is a fixed template — identical across every TODO lesson, no per-lesson dynamic content — so the dropbox sync stays a pure idempotent function of `authoringStatus`. **Ghost Lessons** are not published, so the marker never applies to them.

## Rejected alternatives

- **Renaming the lesson directory** (e.g. prefixing with `TODO-`) — would break path stability for downstream consumers and is awkward when the lesson has no videos yet, since the directory might be the only thing identifying it.
- **A separate top-level `todo-lessons.md` manifest** at the course root — redundant once the per-section buckets exist in the changelog; would also duplicate the per-lesson signal that `TODO.md` already carries.
- **A per-version "Currently TODO" snapshot block** at the top of each version section in the changelog — prototyped (see `app/services/changelog-todo-prototype/`, since deleted) and dropped: the `TODO.md` markers in the dropbox tree carry the per-lesson signal, and the Marked Ready / Marked TODO buckets carry the version-level signal. A separate aggregate list was redundant noise.
- **Freezing the dropbox folder contents for TODO lessons** (skip copying videos/transcripts/source files while in TODO state) — contradicts the snapshot-mirrors-author-state model and would require the publish service to remember prior state, which it does not today. The phrase "don't change it" was always aimed at the downstream consumer's course-platform stub, not at the dropbox folder itself.

## Lineage, not path

Transition buckets follow `previousVersionLessonId`, not the lesson's path. A lesson that is renamed _and_ flips status in the same publish is rendered in the transition bucket (with its new path), not in **Renamed**. This matches how the rest of the changelog handles lineage and keeps the status signal from being masked by a rename.
