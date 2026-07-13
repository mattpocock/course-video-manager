# course.json fields are required, and incomplete Videos fail the Publish

Every field on a **Video** in `course.json` — `relativePath`, `hash`, `body`, and `description` — is **required and non-nullable**. A Video reaches the manifest only if it is complete: it has exportable **Clips** (which produce its `.mp4` and its **Export Hash**) and both an authored `body` and `description`. When a shipping Video is missing any of these, **Publish fails** with the full list of gaps rather than emitting a `null`.

## Why this shape

- **A `null` here was fake optionality, not real optionality.** These fields were previously `NullOr(String)`, but a null never meant "this Video legitimately has no path/hash/body/description" — it meant the Video was unfinished. `relativePath` and `hash` were null exactly when the Video had no Clips (nothing to ship); `body`/`description` were null when the author simply hadn't written them yet. Each is a gap on our side, so the manifest should never carry it. A downstream consumer should be able to trust that every emitted Video has a real file path, a real hash, and real copy.

- **The Publish is the right place to catch it.** Publish is already the gate that decides "what this course ships" (the effective-output filter, role-combo validation). Requiring completeness there means a broken manifest can never reach Dropbox — the failure is loud, at the moment of publishing, naming the offending Videos.

- **Collect every gap, then fail.** `buildCourseJson` scans the whole course, gathers every incomplete Video (`IncompleteVideosError` carries a list of `{ sectionPath, lessonPath, videoTitle, missing }`), and fails once. The author fixes all gaps in a single pass instead of re-running Publish and hitting them one at a time.

## Considered alternatives

- **Silently elide clip-less Videos** (the way empty Sections are elided). Rejected: a Video with no Clips inside a shipping Lesson is a mistake we want surfaced, not a Video to quietly drop. Dropping it hides the problem and can leave a Lesson looking complete when it isn't.

- **Keep `body`/`description` genuinely optional (key-absent, not null).** Rejected for these two fields: every shipping Video is supposed to have both, so a missing one is an authoring gap to catch, not honest absence.

- **Fail fast on the first gap.** Rejected: whack-a-mole. Collecting all gaps up front is strictly friendlier when a course has several unfinished Videos.

## What stays optional

- **`lesson.solution`** remains an optional (key-absent) field. A **Problem** Lesson can legitimately ship without a worked-solution Video, so its absence is real optionality — modelled honestly as a missing key, never as `null`.

## Surfaced before publish, not just at publish

The failure is a lousy first line of defence — by the time `buildCourseJson` throws, the author has already hit Publish. So the blockers are enumerated **up front** and shown on the publish page, where they block the button (exactly like the existing "unexported videos" and "course-view lints" gates).

The key move is a single shared collector, `collectPublishBlockers(sections, includeTodoLessons)`, that walks the effective output once and returns **every** blocker: incomplete Videos _and_ invalid Lesson role combos (a lone solution, an explainer beside a problem, duplicate roles, …). Both consumers read it:

- **The publish page** (`validatePublishability` → loader → amber warning cards) lists them per toggle position and disables Publish until they're fixed.
- **`buildCourseJson`** calls the same collector as its backstop and fails on a non-empty result.

Because the warning and the failure derive from the _same walk_, they can never disagree — the thing that warns you is literally the thing that would fail. Invalid Lesson combos, previously also invisible (they surfaced only as the generic "Publish failed unexpectedly"), now show on the page too.

## Consequences

- `CourseJsonVideo` fields `relativePath`, `hash`, `body`, `description` are now `Schema.String`; `$schema` on the document is now required (the builder always emits it). The generated `course.schema.json` sidecar tightens to match.
- `buildCourseJson`'s error channel gains `IncompleteVideosError` alongside `InvalidLessonRoleComboError`; both propagate through Publish and fail it loudly as the backstop.
- `collectPublishBlockers` is the single source of truth for "why can't this publish?"; `validatePublishability` returns its `incompleteVideos` and `invalidLessonCombos` for both toggle positions, and the publish page blocks on them.
- Archived Videos are never checked — completeness is asked only of Videos that actually ship.
