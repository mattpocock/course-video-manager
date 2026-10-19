# Test pruning

Matt's goal: fewer tests, each one earning its place. The bar is the
"What earns a test its place" rule in [`TESTING_STANDARDS.md`](../TESTING_STANDARDS.md#what-earns-a-test-its-place):
a test must be able to fail for a plausible real bug in behavior a user or
caller observes.

This file classifies every test file in the repo (audit of 2026-10-06, 371
files, ~4,850 test cases) as **keep / trim / delete / consolidate**, with a
one-line reason, a confidence, its test count and its local runtime. Trims name
the exact test titles to remove, under each area's "Trim details".

## How to take a batch

1. Pick one batch below. Batches touch disjoint files, so several agents can
   run at once.
2. In each file, act on the rows and the named tests only. Re-read every test
   before you remove it: if it is the last guard on a real rule (grep for other
   tests of the same function), keep it or fold its assertion into a survivor.
   If unsure, keep.
3. Run the touched files, then land the batch through `docs/agents/merging.md`
   with the deleted tests listed in the PR body, grouped by reason.
4. Mark the rows `done (batch N)` here in the same PR.

Never touch `entity-menus.test.ts` or `features/entity-links/` under this plan.
They are guard tests owned elsewhere.

## Batches

**Next batch: 7** (animatic, teleprompter, publish, video-posting, deliverables, beats). Batches 1 to 6 are done;
take the lowest-numbered batch whose row does not say **Done.**

**Batch 1: done.** It removed the high-confidence deletes and trims across
all areas: 9 files deleted, about 50 trimmed. Rows marked `done (batch 1)`
had their high-confidence items removed. Trims tagged "(medium)" inside those
files remain for the area's batch below.

| Batch | Scope                                                                                                  | What is left                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | `apps/local/app/cli/` (area C)                                                                         | **Done.** See "Batch 2" below.                                                                                                                                                                                                                  |
| 3     | `packages/core/` (area A)                                                                              | **Done.** See "Batch 3" below.                                                                                                                                                                                                                  |
| 4     | `apps/local/app/services/` (area B)                                                                    | **Done.** See "Batch 4" below.                                                                                                                                                                                                                  |
| 5     | `features/video-editor/`, `features/article-writer/` (area D)                                          | **Done.** See "Batch 5" below.                                                                                                                                                                                                                  |
| 6     | `features/course-view/`, `features/upload-manager/`, `features/diagrams/` (area E)                     | **Done.** See "Batch 6" below.                                                                                                                                                                                                                  |
| 7     | animatic, teleprompter, publish, video-posting, deliverables, beats (area F)                           | Medium deletes of static-markup tests (`animatic-empty-state`, `teleprompter/beats-view`) and `auto-select-thumbnail`; medium trims across the animatic and teleprompter files; fold `deliverable-grouping-buffer` into `deliverable-grouping`. |
| 8     | `lib/`, `hooks/`, `.sandcastle/`, `packages/lucide-icons`, `packages/overlay-renderer` (areas A and C) | Small remainder, including the medium deletes `queue-tree` and `timeline-visibility`.                                                                                                                                                           |

**Batch 2: done.** It trimmed the CLI files (737 → 670 tests) and cut the
per-test setup cost every PGlite test pays:

- `truncateAllTables` issues one `TRUNCATE` naming every table instead of one
  per table. That was ~90ms per call, most of a typical DB test; it is now
  ~15ms. It helps every PGlite-backed test in the repo, not just the CLI.
- `createUnreachableDb()` replaces "create a PGlite, then close it" in the
  database-failure tests. `close()` alone took about a second.
- `cli-search` and `cli-integration` seed once per describe where no test
  writes (`beforeAll(reseed)`), and per test only where one does.

Where the plan's trim was the last guard on a rule, batch 2 kept it or folded
its assertion into a survivor instead: chapter append order, the
clip-mockup-chapter `get` success path, deliverable re-archive, lesson rename
keeping its authoring status, the per-noun `withName` and archived-scope-root
checks (each now one test over all nouns), and the clip-mockup and footage
local-only resource names.

**Batch 3: done** (PRs #1829, #1830, #1831; split in three because it
deleted ~3,800 lines). It pruned `packages/core/`: 670 → 530 tests in
`@cvm/core`, 64 → 58 files; local `vitest run` for the package went from
11.3s to 9.1s wall (34.3s → 29.7s summed per-file time).

- The five `course-write-*` files are one `course-write-e2e.test.ts` (24 → 13).
- `db-version-copy` has a `COPY_SPEC` drift guard like
  `db-duplicate-course-drift`, so a new column on a copied table fails until
  it is classified. The two `*.clip-mockup-chapters` files are folded into
  their parents.
- Writing that guard showed `copyVersionStructure` does not carry
  `videos.format`, `clips.zoomType` or `clips.diagramSnapshotId` (the guard
  lists them as `notCopied` with a comment). That looks like a real bug and
  needs its own issue.

Plan trims kept or folded because they were the last guard on a rule:
`getCourseStructureById` returning `memory` (kept; the column list is
explicit and video-posting-context reads it), copyVideo "does not rename the
source when renameOld is false" (kept; renaming the source is destructive),
clip-zoom "allows every camera scene" (kept; the only positive eligibility
check), and folded into survivors: a known zoom level resolving, transcript
`indexedClips` source metadata, `flattenRichText` on a content-less doc,
section paths with a double-digit number and multi-word slug, archived
diagrams hidden by default, `getDiagram`'s success path, snapshots
unpreserved by default, and pitches with no videos still listed.

**Batch 4: done** (PRs #1876, #1877 and the PR that marked this; split in
three by file family). It pruned `apps/local/app/services/`: 705 → 639 tests
across the area's 76 files, and `@cvm/local` 3,872 → 3,806.

- The seven `clip-service-*` files share one harness,
  `clip-service-test-setup.ts`.
- `course-publish-service.test.ts` and `-batch-export` run on
  `setupPublishableCourse`; `course-publish-dropbox-sync` runs on
  `setupUploads`. The bundle readers (`remoteBundleVideoPaths`,
  `receiptManifest`) are bound to each setup's own fake Dropbox through
  `bundleReaders`, so the publish files import them instead of redefining
  them.
- The optional fold of `export-hash-overlay-animation` and
  `export-hash-camera-version` back into `export-hash.test.ts` was not taken.

Plan trims kept or folded because they were the last guard on a rule:
ClipService "updates pause type for a single clip" and "updates the name of a
chapter" (kept; the only tests of the `update-pause` and `update-chapter`
events, which `updateClips` does not go through), overlay-content-renderer
"carries both Animation Toggles" (kept; the renderer schema defaults both to
false, so a dropped toggle passes every other test), and folded into
survivors: an effect clip is created already transcribed, a Buffer post's
`remoteUrl` starts null, plain `http://` images are skipped by the Cloudinary
upload, and a re-export's SHA256 replaces the previous Bundle's in the
manifest (the cited dropbox-upload test clears the remote first, so never
sees a copied-forward digest).

**Batch 5: done** (one PR). It pruned `features/video-editor/` and
`features/article-writer/`: 715 → 662 tests across the two folders (73 → 72
files). `writable-field.test.ts` is folded into `writer-engine-utils.test.ts`
(its storage-key hygiene test moved; the rest duplicated it). Every row named
in the plan still existed after the recorder work, so none was skipped as
stale.

Plan trims kept or folded because they were the last guard on a rule:
`commit-map-components` "is static — it draws no buttons" (kept; the card is
deliberately static, unlike the site's), clip-state-reducer-diagram-pin "only
updates the targeted clip" (kept; the only test of the `clipId` match),
`targetProfileForFormat` (two tests folded into one; the only guard that a
Short records on the TikTok profile), and folded into survivors: a
`submitted` chat holds a send like a `streaming` one, a persisted Reference
tab is honoured and a persisted Beats tab falls back once the beats are
gone, and create-video-from-selection in move mode asks for a move.

**Batch 6: done** (one PR). It trimmed `features/course-view/` and
`features/diagrams/`: 606 → 575 tests across the three folders (51 files, none
deleted). `features/upload-manager/` had nothing left to act on: its trim and
consolidate rows went with the browser Upload Manager (#1930, #1938, #1926,
sidecar batch 6). Files added since the audit (`duplicate-course-reducer`, the
`diagram-playground-reducer*` files, `head-autosaver`,
`tldraw-license-key.server`, `upload-timing`, the two browser tests) were not
audited and are untouched.

Plan trims kept or folded because they were the last guard on a rule:
course-editor-helpers "counts a todo lesson that has videos with clips as
todo" is folded into "counts a todo lesson as todo whether or not it has
videos" (the only `computeTodoCount` guard that clips do not make a lesson
done). The optional `test.each` merge of the one-line "patches X" tests in
`optimistic-applier.test.ts` was not taken.

### Coverage gaps batch 1 exposed

Batch 1 removed tests that exercised a copy of the logic written inside the
test file, so these never had real coverage. If they matter, extract a pure
function and test it there:

- The lesson title save guard (`lesson-title-editor`).
- The upload manager's retry effect (`upload-manager-integration`).
- The audio boost Strict Mode fix (fcdc392c, `use-audio-boost`). One
  `renderHook` test that mounts twice would guard it.

## Slowest files

Local runtimes, measured one package at a time. `@cvm/local` is about 75% of
all tests and runs in four CI shards of about 1m40s each.

| file                                                                | tests | runtime |
| ------------------------------------------------------------------- | ----- | ------- |
| apps/local/app/services/course-publish-dropbox-upload-reuse.test.ts | 6     | 6.3s    |
| apps/local/app/cli/cli-clip-mockup-ordering.test.ts                 | 33    | 5.6s    |
| apps/local/app/services/course-publish-dropbox-upload.test.ts       | 12    | 5.5s    |
| apps/local/app/cli/cli-integration.test.ts                          | 43    | 5.0s    |
| apps/local/app/cli/cli-lesson-video-writes.test.ts                  | 46    | 4.4s    |
| apps/local/app/cli/cli-beat-writes.test.ts                          | 30    | 4.0s    |
| apps/local/app/cli/cli-search.test.ts                               | 36    | 3.9s    |
| apps/local/app/cli/cli-overlay-writes.test.ts                       | 28    | 3.9s    |
| packages/core/services/db-diagram-operations.test.ts                | 35    | 3.8s    |
| apps/local/app/services/course-publish-dropbox-sync.test.ts         | 14    | 3.7s    |
| packages/core/services/db-beat-operations.test.ts                   | 31    | 3.7s    |
| apps/local/app/cli/cli-clip-mockup-writes.test.ts                   | 27    | 3.6s    |
| apps/local/app/cli/cli-clip-writes.test.ts                          | 27    | 3.6s    |
| apps/local/app/cli/cli-learning-goal-writes.test.ts                 | 24    | 3.5s    |
| packages/core/services/db-learning-goal-operations.test.ts          | 28    | 3.3s    |
| apps/local/app/cli/cli-clip-mockup-chapter.test.ts                  | 21    | 3.2s    |
| apps/local/app/cli/cli-chapter-writes.test.ts                       | 18    | 3.1s    |
| apps/local/app/cli/cli-section-writes.test.ts                       | 28    | 3.1s    |
| apps/local/app/cli/cli-overlay-bullet-panel-writes.test.ts          | 26    | 3.1s    |
| apps/local/app/cli/cli-lesson-move-update.test.ts                   | 24    | 2.9s    |

The slow files are almost all PGlite-backed: CLI round trips and `db-*` services. Cutting near-duplicate cases in them saves the most CI time per test removed.

# Audit

## Area A: Packages, root guards, .sandcastle, stream-deck

| file                                                                    | tests                          | runtime | verdict     | conf   | status         | reason                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------ | ------- | ----------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| .sandcastle/no-recent-commits.test.ts                                   | 1 (each, 1 row per prompt .md) | 0.0s    | keep        | high   |                | Guard/convention test from a fix commit (#860): keeps `<recent-commits>` out of prompts                                                                                                      |
| .sandcastle/review/parse-diff-lines.test.ts                             | 12                             | 0.0s    | trim        | medium |                | Parser with fix provenance; one near-duplicate empty-input case                                                                                                                              |
| .sandcastle/run-with-extraction.test.ts                                 | 8                              | 0.0s    | trim        | high   | done (batch 1) | Retry loop now delegates to runWithRetry (f3449a05); 4 retry-semantics tests duplicate run-with-retry.test.ts                                                                                |
| .sandcastle/run-with-retry.test.ts                                      | 8                              | 0.0s    | keep        | high   |                | Owns the retry contract; promptArgs test is a fix regression (b600da7b)                                                                                                                      |
| apps/local/stream-deck-forwarder/connection-log.test.ts                 | 7                              | 0.0s    | trim        | medium |                | Fix regression (#1746) for churn collapsing; one test is subsumed by others                                                                                                                  |
| apps/local/stream-deck-forwarder/run-stream-deck-forwarder.test.ts      | 2                              | 0.2s    | keep        | high   |                | Real socket integration for rebroadcast and no-echo rules                                                                                                                                    |
| packages/core/db/database-url.test.ts                                   | 6                              | 0.0s    | trim        | high   | done (batch 1) | resolveDatabaseUrl is a one-line pass-through; keep only the direct/fallback/empty rules                                                                                                     |
| packages/core/db/migrations.test.ts                                     | 4                              | 2.9s    | trim        | medium | done (batch 3) | migrate-equals-pushSchema and baseline hash are real guards; the other two are subsumed or test drizzle itself (and each boots PGlite)                                                       |
| packages/core/db/schema-feature-probes.test.ts                          | 3 (+1 per probe)               | 0.0s    | trim        | medium | done (batch 3) | Probe pass/fail tests are real; the name-list test restates the constant                                                                                                                     |
| packages/core/features/videos/bullet-panel.test.ts                      | 12                             | 0.0s    | keep        | high   |                | Timing rules with two marked regressions; the hash payload is a frozen cache address                                                                                                         |
| packages/core/features/videos/clip-zoom.test.ts                         | 11 (6 loop-generated)          | 0.0s    | trim        | medium | done (batch 3) | Preview==export pixel agreement is the core guard; constant-pinning and self-iterating tests add nothing                                                                                     |
| packages/core/features/videos/overlay-transform.test.ts                 | 16 (6 loop-generated)          | 0.1s    | trim        | high   | done (batch 1) | The 2000-step sweep (regression) subsumes the 6 point-sample agree tests; one test re-reads the table shape                                                                                  |
| packages/core/features/videos/retime-cascade.test.ts                    | 21                             | 0.0s    | trim        | medium | done (batch 3) | Real retime rules, but several near-duplicate boundary/no-op cases                                                                                                                           |
| packages/core/lib/api-token.server.test.ts                              | 7 (+6 each rows)               | 0.0s    | trim        | medium | done (batch 3) | Token format/parse/hash rules matter (fix provenance); uniqueness test only checks crypto randomness                                                                                         |
| packages/core/lib/authoring-status.test.ts                              | 2                              | 0.0s    | keep        | high   |                | Fix regression: null authoringStatus means done                                                                                                                                              |
| packages/core/lib/extract-scene-text/tests/extract-scene-text.test.ts   | 33                             | 0.0s    | trim        | medium | done (batch 3) | Real extraction rules, but heavy repetition per shape type; fold into it.each and drop duplicate empty-input cases                                                                           |
| packages/core/lib/scene-hash.test.ts                                    | 10                             | 0.0s    | trim        | high   | done (batch 1) | hashScene = sha256(canonicalize); hash tests duplicate the canonicalize tests, plus one tests SHA-256 output format                                                                          |
| packages/core/lib/transcript-builder.test.ts                            | 24                             | 0.0s    | trim        | medium | done (batch 3) | Core serializer worth keeping; ~6 tests restate the same interleave/index/word-count rules                                                                                                   |
| packages/core/rpc/schema-version.test.ts                                | 5 (+8 each rows)               | 0.0s    | keep        | high   |                | Header parse edge cases plus a misleading-message regression                                                                                                                                 |
| packages/core/rpc/wire.test.ts                                          | 8                              | 0.0s    | trim        | medium | done (batch 3) | Error round-trip and cause-leak guards matter; two tests are trivial or duplicates                                                                                                           |
| packages/core/services/course-write-e2e.test.ts                         | 8                              | 1.1s    | consolidate | medium | done (batch 3) | Target for merging all 5 course-write-*.test.ts files (each copies the same ~100-line setup); drop dup/pass-through tests                                                                    |
| packages/core/services/course-write-lesson-ops.test.ts                  | 4                              | 0.8s    | consolidate | medium | done (batch 3) | Merge into course-write-e2e.test.ts; same setup copied; one dup test                                                                                                                         |
| packages/core/services/course-write-move.test.ts                        | 4                              | 0.9s    | consolidate | medium | done (batch 3) | Merge into course-write-e2e.test.ts; 2 of 4 are weaker variants of the same move                                                                                                             |
| packages/core/services/course-write-reorder.test.ts                     | 4                              | 0.9s    | consolidate | medium | done (batch 3) | Merge into course-write-e2e.test.ts; 3 of 4 are dups (reverse order twice, trivial single, insert-before duplicate)                                                                          |
| packages/core/services/course-write-section-ops.test.ts                 | 4                              | 0.7s    | consolidate | medium | done (batch 3) | Merge into course-write-e2e.test.ts; no-op-reorder test is trivial                                                                                                                           |
| packages/core/services/db-api-token-operations.test.ts                  | 13                             | 1.4s    | trim        | medium | done (batch 3) | Auth accept/reject/revoke rules are security-relevant; explicit-expiry test is pass-through                                                                                                  |
| packages/core/services/db-beat-operations.list.test.ts                  | 1                              | 0.5s    | keep        | high   |                | One test pins a real multi-level ordering and archive filter                                                                                                                                 |
| packages/core/services/db-beat-operations.test.ts                       | 31                             | 3.7s    | trim        | medium | done (batch 3) | Ordering/LG-link/cascade rules are real; ~14 CRUD pass-through, not-found and duplicate tests                                                                                                |
| packages/core/services/db-clip-mockup-comment-copy.test.ts              | 2                              | 0.5s    | keep        | high   |                | Re-pointing comments at copied parents in both copy paths is data integrity                                                                                                                  |
| packages/core/services/db-clip-mockup-comment-operations.test.ts        | 8                              | 1.1s    | keep        | medium |                | One-parent CHECK, draft-guard wiring, and archived-parent hiding are real rules                                                                                                              |
| packages/core/services/db-clip-mockup-operations.test.ts                | 9                              | 1.1s    | trim        | high   | done (batch 1) | The overlap test says it cannot fail under PGlite (passes with the lock removed); one trivial not-found test                                                                                 |
| packages/core/services/db-course-operations-list-ordering.test.ts       | 2                              | 0.6s    | keep        | medium |                | Ordering of two list queries; small, and nothing else checks it                                                                                                                              |
| packages/core/services/db-course-operations-name-guard.test.ts          | 10                             | 1.1s    | trim        | high   | done (batch 1) | "(no filePath)" describe is an exact copy of the first describe (filePath no longer exists)                                                                                                  |
| packages/core/services/db-course-operations-slim-clips.test.ts          | 2                              | 0.6s    | keep        | medium |                | Join shape (learningGoalIds, no leaked join rows) for the slim read                                                                                                                          |
| packages/core/services/db-deliverable-operations.test.ts                | 3                              | 0.6s    | trim        | medium | done (batch 3) | +7 days and month-boundary rules are real; "no links" variant duplicates the first                                                                                                           |
| packages/core/services/db-diagram-component-operations.test.ts          | 23                             | 2.0s    | trim        | medium | done (batch 3) | Validation rules and recency are real; drop trivial empty/list-shape/duplicate 404 tests                                                                                                     |
| packages/core/services/db-diagram-operations.test.ts                    | 35                             | 3.8s    | trim        | medium | done (batch 3) | Untitled-N numbering and snapshot dedup/preserve rules are real; ~13 are CRUD round-trips or duplicates of scene-hash                                                                        |
| packages/core/services/db-diagram-restore-from-search.test.ts           | 5                              | 0.8s    | keep        | medium |                | Auto-preserve and dedup on restore are real rules                                                                                                                                            |
| packages/core/services/db-diagram-search-query.test.ts                  | 13                             | 1.5s    | trim        | medium | done (batch 3) | Search semantics (AND/OR/stemming/dedup/order) are worth keeping; 2 trivial                                                                                                                  |
| packages/core/services/db-diagram-search-text.test.ts                   | 6                              | 0.9s    | keep        | medium |                | searchText population and generated tsvector column (schema)                                                                                                                                 |
| packages/core/services/db-diagram-snapshot-operations.test.ts           | 22                             | 2.2s    | trim        | medium | done (batch 3) | Pin/unpin/FK/dedup rules matter; ~7 empty-result, shape, idempotent-noop and duplicate not-found tests                                                                                       |
| packages/core/services/db-duplicate-course-drift.test.ts                | 2                              | 0.6s    | keep        | high   |                | Schema-drift guard: every column must be classified and carried across                                                                                                                       |
| packages/core/services/db-duplicate-course.clip-mockup-chapters.test.ts | 1                              | 0.4s    | consolidate | low    | done (batch 3) | Merge into db-duplicate-course.test.ts (155 lines of mostly fixture for one assertion)                                                                                                       |
| packages/core/services/db-duplicate-course.test.ts                      | 19                             | 2.8s    | trim        | medium | done (batch 3) | Drift guard already covers per-field copying; collapse 4 "copies X and excludes archived X" into one; drop trivial ones                                                                      |
| packages/core/services/db-duplicate-course.thumbnails.test.ts           | 2                              | 0.6s    | keep        | high   |                | Regression for fix #1677 (thumbnails aliasing the source)                                                                                                                                    |
| packages/core/services/db-learning-goal-operations.test.ts              | 28                             | 3.3s    | trim        | medium | done (batch 3) | Ordering, draft guard wiring and join-row cascade are real; ~8 pass-through/duplicate not-found tests                                                                                        |
| packages/core/services/db-pitch-effort.test.ts                          | 7                              | 1.0s    | trim        | medium | done (batch 3) | Sort and filter rules are real; default value and number round-trip are tautological                                                                                                         |
| packages/core/services/db-pitch-operations.test.ts                      | 32                             | 2.6s    | trim        | medium | done (batch 3) | Sort/filter/SET NULL/archive-exclusion are real; ~10 CRUD, empty-list and duplicate-sort tests                                                                                               |
| packages/core/services/db-pitch-state.test.ts                           | 16                             | 1.5s    | trim        | medium | done (batch 3) | State derivation is a business rule with a fix (#1690); 3 tests duplicate pitch-ops or a sibling                                                                                             |
| packages/core/services/db-service-append-clips.test.ts                  | 10                             | 1.4s    | keep        | medium |                | Timeline insertion ordering (OBS append path) is a fragile real rule                                                                                                                         |
| packages/core/services/db-service-clip-ordering.test.ts                 | 13                             | 1.7s    | keep        | medium |                | Reorder/move across mixed clip/chapter timeline is a real rule                                                                                                                               |
| packages/core/services/db-service-course-structure.test.ts              | 8                              | 1.2s    | trim        | medium | done (batch 3) | Archive filter and ordering are real; 2 duplicate or column-shape tests                                                                                                                      |
| packages/core/services/db-service-video-navigation.test.ts              | 18                             | 2.8s    | keep        | medium |                | Prev/next and empty-lesson navigation across lessons/sections are real rules                                                                                                                 |
| packages/core/services/db-version-copy.clip-mockup-chapters.test.ts     | 1                              | 0.4s    | consolidate | low    | done (batch 3) | Merge into db-version-copy.test.ts (mostly fixture for one assertion)                                                                                                                        |
| packages/core/services/db-version-copy.test.ts                          | 11                             | 1.4s    | consolidate | medium | done (batch 3) | copyVersionStructure has no drift guard; replace the 5 field-preservation tests with a COPY_SPEC drift test like db-duplicate-course-drift, and merge the 4 archive-exclusion tests into one |
| packages/core/services/db-version-lineage.test.ts                       | 5                              | 0.8s    | trim        | medium | done (batch 3) | Lineage copy-forward is data integrity; the 3 section/lesson/video variants should be one test                                                                                               |
| packages/core/services/db-version-slim.test.ts                          | 3                              | 0.6s    | keep        | medium |                | Slim read's column restriction and archive filters are its point                                                                                                                             |
| packages/core/services/db-video-archive.test.ts                         | 4                              | 0.8s    | keep        | medium |                | Soft delete, idempotency and the 404-message contract                                                                                                                                        |
| packages/core/services/db-video-body-description.test.ts                | 7                              | 1.0s    | trim        | medium | done (batch 3) | Mostly CRUD pass-through; keep one body round-trip and the version copy-forward                                                                                                              |
| packages/core/services/db-video-format.test.ts                          | 7                              | 0.9s    | trim        | medium | done (batch 3) | Format filter and clear-lessonId rules matter (fix #1691); 2 duplicates                                                                                                                      |
| packages/core/services/db-video-operations.copy.test.ts                 | 11                             | 1.2s    | trim        | medium | done (batch 3) | "(old)" disambiguation and mockup copy are real; 3 flag-off or empty-source no-ops                                                                                                           |
| packages/core/services/db-video-post-operations.test.ts                 | 8                              | 1.0s    | trim        | medium | done (batch 3) | Cascade delete and scoping are real; 3 CRUD/empty tests                                                                                                                                      |
| packages/core/services/db-video-unlink-from-pitch.test.ts               | 2                              | 0.4s    | trim        | low    | done (batch 3) | Single-column update; keep the one behaviour test, drop not-found                                                                                                                            |
| packages/core/services/draft-guard.server.test.ts                       | 24                             | 2.2s    | keep        | high   |                | Draft/published guard plus the transactional-rollback regression; central data-integrity rule                                                                                                |
| packages/core/services/lesson-move-planner.test.ts                      | 11                             | 0.0s    | keep        | high   |                | Fix #1608 (planner corrupting titles); pure planner rules                                                                                                                                    |
| packages/core/services/lesson-path-service.test.ts                      | 25                             | 0.0s    | trim        | high   | done (batch 1) | toSlug has 13 near-identical cases; legacy parse has redundant variants                                                                                                                      |
| packages/core/services/path-projection.test.ts                          | 24                             | 0.0s    | trim        | high   | done (batch 1) | 8 deriveSection/LessonPath tests duplicate the *-path-service tests (path-projection just re-exports them); a few trivial empty cases                                                        |
| packages/core/services/section-path-service.test.ts                     | 9                              | 0.0s    | trim        | medium | done (batch 3) | Keep derive and parse rules; drop redundant variants                                                                                                                                         |
| packages/core/services/thumbnail-path-rebase.test.ts                    | 5                              | 0.0s    | keep        | high   |                | Regression for fix #1677; pure path-rewrite rules                                                                                                                                            |
| packages/core/services/with-db-transaction.test.ts                      | 4                              | 0.8s    | trim        | medium | done (batch 3) | Commit/rollback/typed-error are real; the "typecheck" test duplicates commit                                                                                                                 |
| packages/lucide-icons/tests/generator.test.ts                           | 10                             | 0.0s    | keep        | high   |                | Append-only invariant for the vendored table is a real rule                                                                                                                                  |
| packages/lucide-icons/tests/icon-table.test.ts                          | 12                             | 0.0s    | trim        | medium |                | Whole-set sweeps and backfill names are real guards; 2 subsumed                                                                                                                              |
| packages/lucide-icons/tests/search.test.ts                              | 14                             | 0.0s    | trim        | medium |                | Ranking and recency rules are product behaviour; 2 duplicates                                                                                                                                |
| packages/lucide-icons/tests/to-path-builder.test.ts                     | 26                             | 0.1s    | keep        | medium |                | Geometry transpiler; each case is a distinct SVG rule plus a whole-set sweep                                                                                                                 |
| packages/overlay-renderer/tests/bullet-panel-timing.test.ts             | 6                              | n/a     | trim        | medium |                | Exit-timing regression is real; one test mirrors the formula                                                                                                                                 |
| packages/overlay-renderer/tests/props.test.ts                           | 16                             | n/a     | trim        | high   | done (batch 1) | Mostly checks that zod keeps fields verbatim or rejects missing ones; keep defaults and the 4-bullet cap                                                                                     |
| tests/effect-guards.test.ts                                             | 10                             | 0.0s    | keep        | high   |                | Guard/convention test (shrink-only allowlist)                                                                                                                                                |
| tests/workspace-layout.test.ts                                          | 8                              | 0.0s    | keep        | high   |                | Guard/convention test (workspace dependency boundaries)                                                                                                                                      |

### Trim details

#### .sandcastle/review/parse-diff-lines.test.ts

- "returns empty map for whitespace-only diff" — same rule as "returns empty map for empty diff"

#### .sandcastle/run-with-extraction.test.ts

- "describes a missing tag distinctly from a validation failure" — retry-prompt wording is runWithRetry's; covered in run-with-retry.test.ts
- "rethrows the final StructuredOutputError after exhausting attempts" — runWithRetry's contract, already tested there
- "honours a custom maxAttempts" — runWithRetry's contract (pass-through here)
- "does not retry on a non-StructuredOutputError" — runWithRetry's contract, already tested there

#### apps/local/stream-deck-forwarder/connection-log.test.ts

- "prints each origin on its first connect" — covered by the first-connect test and "collapsing one origin does not silence another"

#### packages/core/db/database-url.test.ts

- "is the pooled connection string" — one-line pass-through of env.DATABASE_URL
- "is undefined when DATABASE_URL is unset" — same pass-through
- "is undefined when neither is set" — trivial `||` fallthrough

#### packages/core/db/migrations.test.ts

- "applies the baseline migration on a fresh database" — subsumed by "migrate produces the same public-schema tables as pushSchema"
- "is a no-op when the baseline is already registered" — tests drizzle's migrator idempotency (third-party); also a slow PGlite boot

#### packages/core/db/schema-feature-probes.test.ts

- "covers every feature the hosted database is at risk of not supporting" — restates the SCHEMA_FEATURE_PROBES name list

#### packages/core/features/videos/clip-zoom.test.ts

- "passes through every known level" — iterates CLIP_ZOOM_TYPES against itself
- "pins the subtle shot: 115%, centred in x, biased above centre in y" — restates the constant; behaviour is covered by "crops toward the top of frame" and the agreement tests
- "allows every camera scene" — iterates ZOOMABLE_SCENES against the function that reads it

#### packages/core/features/videos/overlay-transform.test.ts

- "agree at t=${moment}s" (loop, 6 generated tests) — strictly subsumed by "agree at EVERY moment of the move, not only at the ends" (2000-step sweep)
- "states every end of every move as an offset alone" — checks the table's own key shape; "never puts a scale in the preview's CSS" and "hands the export back a frame of the source's own size" cover the behaviour

#### packages/core/features/videos/retime-cascade.test.ts

- "drops a word pushed off the front of the Clip" — "shifts every word by the delta, keeping its text" already shows "the" dropped with the same input
- "leaves a word untouched when nothing about the cut moved" — zero-delta identity; low value
- "does not mutate the words it was given" — implementation detail
- "is idempotent — clamping an already-clamped anchor does nothing" — follows trivially from clamping; the clamp-bound tests cover it

#### packages/core/lib/api-token.server.test.ts

- "never issues the same id or secret twice" — tests crypto randomness, not our code

#### packages/core/lib/extract-scene-text/tests/extract-scene-text.test.ts

- "extracts labels from a geo shape via richText" — fold with text/note/arrow into one it.each over shape types
- "extracts text from a note shape via richText" — as above
- "extracts text from an arrow shape via richText" — as above
- "excludes video shapes" — fold into one it.each with image/bookmark/embed exclusions
- "excludes bookmark shapes (URLs)" — as above
- "excludes embed shapes" — as above
- "ignores marks and attrs on text leaves" — duplicates "rejoins inline runs without spurious separators (bold text)"
- "handles empty doc (no content)" — duplicates the null/no-content-array cases
- "returns empty string when doc has no content array" — duplicates "returns empty string for null/undefined/non-object input"
- "handles a scene with an empty store" — duplicates "never throws on completely invalid input" ({} case)
- "handles mixed shapes — extractable and non-extractable" — combination of "joins multiple shapes" and the exclusion tests

#### packages/core/lib/scene-hash.test.ts

- "produces different output for semantically different scenes" — JSON.stringify inevitably differs; no rule
- "includes schema field in output — different schema versions produce different results" — same
- "produces different hashes for semantically different scenes" — hashScene = sha256(canonicalize); duplicates the canonicalize test
- "produces different hashes when schema version differs (contract)" — duplicate across the seam
- "returns a 64-character hex string (SHA-256)" — tests node:crypto output format

#### packages/core/lib/transcript-builder.test.ts

- "synchronizes indexedClips indices with transcript markers" — duplicates "includes clips with null text in indexedClips but skips in transcript"
- "per-section word counts sum to total wordCount minus markdown overhead" — duplicates the word-count asserts in "correctly interleaves clips and sections"
- "handles clips before the first section with multiple sections" — same rule as "handles clips before the first section correctly"
- "handles null text clips before the first section" — combination of two already-tested rules
- "preserves clip metadata in indexedClips" — pass-through of input fields
- "returns empty for undefined or empty link lists" — trivial guard clause

#### packages/core/rpc/wire.test.ts

- "rebuilds a transport AuthenticationError" — same round-trip rule as the NotFoundError test
- "discriminates the envelope" — trivial `ok === false` check

#### packages/core/services/db-api-token-operations.test.ts

- "honours an explicit expiry" — pass-through of an input field

#### packages/core/services/db-beat-operations.test.ts

- createBeat › "starts with no Learning Goals" — trivial default
- createBeat › "uses the provided kind" — pass-through
- createBeat › "round-trips the setup kind through createBeat and setBeatKind" — just re-checks an enum value
- createBeat › "stores the provided title" — pass-through
- createBeat › "scopes order to each video independently" — asserts only list lengths; weak
- renameBeat › "updates the title" — single-column update
- renameBeat › "fails when the beat does not exist" — generic not-found
- setBeatDescription › "can be cleared back to an empty string" — same as setting any value
- setBeatDescription › "fails when the beat does not exist" — generic not-found
- setBeatKind › "changes the kind while preserving the title" — single-column update
- setBeatLearningGoals › "an empty array clears every link" — covered by "replaces the full set rather than appending"
- setBeatLearningGoals › "fails when the beat does not exist" — generic not-found
- deleteBeat › "excludes archived beats from listBeatsByVideoId" — duplicates "archives the beat instead of hard-deleting"
- moveBeat › "preserves the beat's description across a cross-video move" — the update never touches description

#### packages/core/services/db-clip-mockup-operations.test.ts

- "gives every row its own key when runs on one Video overlap" — its own comment says it passes with the lock removed (PGlite serialises transactions), so it can't catch the bug it describes
- "is a NotFoundError for an unknown id" — generic not-found

#### packages/core/services/db-course-operations-name-guard.test.ts

- createCourse uniqueness guard (no filePath) › "sets slug on course creation" — exact duplicate of the first describe's test
- createCourse uniqueness guard (no filePath) › "rejects duplicate course name" — exact duplicate of "rejects duplicate course name among active courses"

#### packages/core/services/db-deliverable-operations.test.ts

- "duplicates a deliverable with no links" — subset of the first test

#### packages/core/services/db-diagram-component-operations.test.ts

- "allows duplicate names" — asserts the absence of a constraint
- "returns id and name only" — result-shape assertion
- "is empty until something is captured — the library ships empty" — empty-table read
- renameComponent › "404s for an id that is not there" — duplicates takeComponentForInsert's 404 test
- deleteComponent › "404s for an id that is not there" — same

#### packages/core/services/db-diagram-operations.test.ts

- listDiagrams › "excludes archived diagrams by default" — covered by "returns non-archived diagrams sorted by updatedAt desc"
- listDiagrams › "returns empty array when no diagrams exist" — empty read
- listDiagrams › "returns no results when filter matches nothing" — empty read
- getDiagram › "returns a diagram by id" — CRUD round-trip
- updateDiagram › "unarchives a diagram" — mirror of "archives a diagram"
- updateDiagram › "fails with NotFoundError for non-existent diagram" — generic not-found
- updateDiagram › "updating name does not change archived" — partial update; drizzle behaviour
- updateDiagram › "allows setting name and archived in a single update" — pass-through
- updateDiagramHead › "overwrites previous headScene" — same as storing it
- updateDiagramHead › "fails with NotFoundError for non-existent diagram" — generic not-found
- updateDiagramHead › "preserves name and archived when updating head" — partial update; drizzle behaviour
- createSnapshot › "defaults preserved to false" — restates a column default
- createSnapshot › "produces same hash regardless of key insertion order in headScene" — duplicates scene-hash.test.ts

#### packages/core/services/db-diagram-search-query.test.ts

- "returns empty array when nothing matches" — empty read
- "includes searchText and contentHash in results" — result-shape assertion

#### packages/core/services/db-diagram-snapshot-operations.test.ts

- listSnapshots › "returns empty array when diagram has no snapshots" — empty read
- listSnapshotsWithClips › "returns empty clips array for unpinned snapshot" — empty relation
- listSnapshotsWithClips › "includes archived flag on pinning clips" — column-shape assertion
- restoreSnapshotToHead › "does not mutate the snapshot row" — the code never writes to it
- restoreSnapshotToHead › "is idempotent when restoring the same snapshot twice" — follows from copy-to-head
- restoreSnapshotToHead › "fails with NotFoundError for non-existent diagram" — keep the snapshot-not-found and wrong-diagram cases, drop this one
- updateClipDiagramPin › "is idempotent — pinning same snapshot twice returns same result" — repeating the same UPDATE

#### packages/core/services/db-duplicate-course.test.ts

- "creates a new course with the provided name" — pass-through
- "copies null memory field" — trivial edge of the memory copy
- "excludes archived sections from the copy" — "deep-copies sections with correct data…" already asserts only 1 of 2 sections copied
- "copies thumbnails" — field copying covered by db-duplicate-course-drift; path behaviour covered by db-duplicate-course.thumbnails
- "handles course with sections but no lessons" — trivial empty child loop
- Also collapse "copies videos and excludes archived videos", "copies clips and excludes archived clips", "copies chapters and excludes archived chapters", "copies beats and excludes archived beats" into one "copies only active rows at every level" test (field values are already covered by the drift guard)

#### packages/core/services/db-learning-goal-operations.test.ts

- createLearningGoal › "stores the provided fields" — pass-through
- createLearningGoal › "scopes order to each section independently" — weak; asserts only lengths
- updateLearningGoal › "renames via the title field" — covered by "patches only the provided fields"
- updateLearningGoal › "fails when the learning goal does not exist" — generic not-found
- deleteLearningGoal › "excludes archived goals from listLearningGoalsBySectionId" — duplicates "archives the goal instead of hard-deleting"
- moveLearningGoal › "fails when beforeLearningGoalId does not exist" — same anchor check as createLearningGoal's
- moveLearningGoal › "fails when the learning goal does not exist" — generic not-found
- beatIds › "is empty for a Learning Goal no Beat serves yet" — empty relation
- unlinkBeat › "fails when the Learning Goal does not exist" — generic not-found

#### packages/core/services/db-pitch-effort.test.ts

- "defaults to medium (2)" — restates a column default
- "updates effort as a number" — pass-through update

#### packages/core/services/db-pitch-operations.test.ts

- listPitches › "returns empty array when no pitches exist" — empty read
- getPitch › "returns a pitch by id" — CRUD round-trip
- updatePitchField › "updates priority as a number" — pass-through
- listPitches with filters › "sorts by priority asc then createdAt desc" — duplicates the first listPitches test
- listPitches with filters › "returns all non-archived when called with no filters (backward compat)" — duplicates the first listPitches test
- listPitchesWithVideos › "returns pitches with empty videos array when no videos linked" — empty relation
- listPitchesWithVideos › "returns multiple videos per pitch" — drizzle relation behaviour
- getPitchWithVideos › "returns a pitch with its linked videos and clips" — same relation shape as the list variant
- createVideoFromPitch › "creates a video with no clips" — trivial
- createVideoFromPitch › "allows multiple videos from the same pitch" — absence of a constraint

#### packages/core/services/db-pitch-state.test.ts

- "ordering preserved: priority asc, createdAt desc" — duplicates pitch-operations sort test
- "archived pitch excluded regardless of pitch state" — duplicates pitch-operations archive exclusion
- getPitchWithVideos › "returns idle when no deliverables linked" — same derivation as "pitch with no linked deliverable → idle"; the seam is already wired by "derives state from linked deliverables"

#### packages/core/services/db-service-course-structure.test.ts

- "returns empty sections when all are archived" — same filter as "excludes archived sections from results"
- "includes the memory column on the course" — column-shape assertion

#### packages/core/services/db-version-lineage.test.ts

- "copies lesson lineageId forward unchanged on version clone" — fold with the section and video variants into one test over all three levels
- "copies video lineageId forward unchanged on version clone" — as above
- "preserves lineageId across two successive clones" — follows from single-clone copy-forward

#### packages/core/services/db-video-body-description.test.ts

- "can set body to null" — pass-through
- "fails with NotFoundError for a non-existent video" — generic not-found
- "persists an SEO description on a video" — same shape as the body test
- "can set description to null" — pass-through
- "does not affect lesson.description" — different table; can't plausibly break

#### packages/core/services/db-video-format.test.ts

- "creates a landscape video with format landscape" — pass-through (the short variant also checks lessonId null)
- "getAllStandaloneVideos({ format: short }) returns only shorts" — duplicates "getAllStandaloneVideos with format filter returns only matching"

#### packages/core/services/db-video-operations.copy.test.ts

- "does not rename the source when renameOld is false" — flag-off no-op
- "leaves the new video's script null when copyScript is false" — flag-off no-op
- "leaves the copy with no clip mockups when the source has none" — empty-source no-op

#### packages/core/services/db-video-post-operations.test.ts

- "creates a video post with platform and videoId" — covered by the list tests
- "allows multiple posts for the same video" — duplicates "returns all posts for a video"
- "returns empty array when no posts exist" — empty read

#### packages/core/services/db-video-unlink-from-pitch.test.ts

- "fails with NotFoundError for non-existent video" — generic not-found (keep the behaviour test; or delete the whole file, low confidence)

#### packages/core/services/lesson-path-service.test.ts

- toSlug › "converts spaces to dashes" — covered by "handles mixed case with special characters"
- toSlug › "lowercases input" — same
- toSlug › "removes special characters" — same
- toSlug › "trims whitespace" — same family; covered by trimming-dashes and mixed-case
- toSlug › "preserves digits" — trivial
- toSlug › "passes through already-valid slugs" — identity
- toSlug › "handles empty string" — covered by "returns empty string for input with no letters or digits"
- deriveLessonPath › "falls back to 'untitled' for symbols-only title" — same branch as the empty-title fallback
- parseLessonPath › "parses double-digit numbers" — same regex branch as "parses standard path"
- parseLessonPath › "preserves full slug with multiple dashes" — same branch
- parseLessonPath › "parses single-digit legacy path" — same branch as the 3-digit case
- parseLessonPath › "returns null for empty string" — covered by "returns null for path without number prefix"

#### packages/core/services/path-projection.test.ts

- deriveSectionPath › "produces a plain slug from title, no ordering number" — path-projection only re-exports this; tested in section-path-service.test.ts
- deriveSectionPath › "handles title with special characters" — same
- deriveSectionPath › "falls back to 'untitled' for empty title" — same
- deriveSectionPath › "falls back to 'untitled' for symbols-only title" — same
- deriveLessonPath › "produces a plain slug from title, no ordering number" — re-export, tested in lesson-path-service.test.ts
- deriveLessonPath › "handles title with special characters" — same
- deriveLessonPath › "falls back to 'untitled' for empty title" — same
- deriveLessonPath › "falls back to 'untitled' for symbols-only title" — same
- rankByOrder › "returns empty map for empty input" — trivial
- rankByOrder › "handles single item" — trivial
- projectVersionPaths › "returns empty map for empty sections" — trivial
- attachDerivedPaths › "preserves all original fields" — spread pass-through

#### packages/core/services/section-path-service.test.ts

- deriveSectionPath › "falls back to 'untitled' for symbols-only title" — same branch as the empty-title fallback
- parseSectionPath › "parses double-digit section number" — same regex branch as "parses standard path"
- parseSectionPath › "parses multi-word slug" — same branch
- parseSectionPath › "returns null for empty string" — covered by the no-number-prefix case

#### packages/core/services/with-db-transaction.test.ts

- "ops-service factories accept a transaction handle and typecheck" — a typecheck concern (and uses `as any`); duplicates the commit test at runtime

#### packages/lucide-icons/tests/icon-table.test.ts

- "returns raw lucide primitives, not transpiled geometry" — subsumed by "uses only the seven lucide primitives across the whole set" plus generator.test's key-stripping test
- "returns the head of the set for an empty query" — trivial slice; recency ordering on an empty query is covered in search.test.ts

#### packages/lucide-icons/tests/search.test.ts

- "keeps them in recency order, most recent first" — "sorts them to the top of an unfiltered list" already asserts the exact order
- "lists a recent icon exactly once" — covered by "lists a repeated recent name exactly once"

#### packages/overlay-renderer/tests/bullet-panel-timing.test.ts

- "is one ease at the composition's frame rate" — mirrors the formula `Math.round(ease * fps)`

#### packages/overlay-renderer/tests/props.test.ts

- "leaves the Shorts pipeline's existing props untouched" — covered by "defaults every content-kind to empty…"
- "keeps explicit dimensions and a CTA" — zod passes fields through
- "preserves word-timed caption segments verbatim" — zod passthrough
- "keeps a Definition Card's authored title and description verbatim" — zod passthrough (fold its startFrame-defaults-to-0 assert into the defaults test)
- "keeps an explicit Definition Card start frame" — zod passthrough
- "rejects a Definition Card with no description" — zod required field
- "rejects an unknown CTA variant" — zod enum
- "requires durationInFrames" — zod required field
- "keeps a Bullet Panel's title, icons, text and reveal times verbatim" — zod passthrough
- "keeps an explicit Bullet Panel start frame and animation toggles" — zod passthrough
- "rejects a bullet missing its icon or its reveal time" — zod required fields
- "leaves a Definition-Card-only caller's props parsing unchanged" — covered by the defaults test

### Consolidate details

#### course-write-*.test.ts → packages/core/services/course-write-e2e.test.ts (or rename it course-write-service.test.ts)

All five files copy the same ~100-line `setup()` (PGlite + layers + createSection/createLesson/getLesson helpers). Merge into one file with one setup, and drop these while merging:

- course-write-e2e: "full flow produces correct DB rows" (addLesson + a pass-through updateLesson; covered by "creates with authoringStatus todo"), "archives a section regardless of its lessons" (pass-through to lsOps.archiveSection), "is false on a freshly created Draft Version" (first assert of the "flips true" test), "creates a lesson with correct DB state" (duplicates lesson-ops "creates a lesson with correct slug")
- course-write-lesson-ops: "archives a lesson in the database" (subsumed by "archives one lesson without affecting siblings")
- course-write-reorder: "updates order values for all-lessons" (same as "reverses lesson order values"), "normalizes a single lesson order to zero" (sets 0 to 0; nothing normalises), "inserts before the first lesson and shifts others" (same rule as lesson-ops "inserts before an existing lesson when position is specified")
- course-write-move: "moves the only lesson from a section", "handles moving all lessons from a section" (weaker variants of the main move tests)
- course-write-section-ops: "is a no-op when the order has not changed"
  Result: 24 → 13 tests, 5 files → 1.

#### packages/core/services/db-duplicate-course.clip-mockup-chapters.test.ts → packages/core/services/db-duplicate-course.test.ts

One test whose fixture is a richer createFullCourseStructure. Add the interleaved chapter to that fixture and assert it alongside "copies clip mockups in order and excludes archived ones".

#### packages/core/services/db-version-copy.clip-mockup-chapters.test.ts → packages/core/services/db-version-copy.test.ts

Same as above, for copyVersionStructure.

#### packages/core/services/db-version-copy.test.ts (internal)

- Replace "preserves lesson icon (type) when copying a version", "preserves section description when copying a version", "preserves lesson authoringStatus when copying a version", "copies a video's beats, preserving kind/title/order", "copies a video's clip mockups, preserving line/imagePath/order" with one COPY_SPEC drift test (copy db-duplicate-course-drift.test.ts's pattern). That catches every future column, not just these five.
- Merge "skips archived sections when copying a version", "skips archived lessons when copying a version", "excludes archived beats when copying a video", "excludes archived clip mockups when copying a video" into one "copies only active rows at every level" test.
- Keep "serializes concurrent clones from the same latest Course Version" and "does not load clip mockups".
- Also fold db-video-body-description's "copies body and description forward on version clone" into the drift test.
  Result: ~11 (+1 merged file) → ~4.

## Area B: apps/local services

| file                                                                     | tests | runtime | verdict     | conf   | status            | reason                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----- | ------- | ----------- | ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/local/app/services/autofill-service.test.ts                         | 15    | 2.7s    | keep        | high   |                   | Candidate rules, failure isolation, retry and Draft-only guard are all real business rules (it.each = 2 rows)                                                                                                                                                                                            |
| apps/local/app/services/beat-learning-goal-warnings.test.ts              | 9     | 0.0s    | trim        | high   | done (batch 1)    | sectionHasLearningGoals is `length > 0`; its two tests mirror the code. The warning rules stay                                                                                                                                                                                                           |
| apps/local/app/services/buffer-posting-orchestration.server.test.ts      | 4     | 1.4s    | trim        | medium | done (batch 4)    | The row-lifecycle test re-asserts the remoteId/postedAt the happy path already checks                                                                                                                                                                                                                    |
| apps/local/app/services/changelog-service-chapters.test.ts               | 1     | 0.0s    | keep        | high   |                   | Only guard that a Chapter rename shows up as a video update                                                                                                                                                                                                                                              |
| apps/local/app/services/changelog-service-empty-sections.test.ts         | 3     | 0.0s    | delete      | high   | done (batch 1)    | Admits empty sections are filtered at the DB layer, so it tests nothing about them. Tests 1 and 2 use the same fixture as changelog-service "shows no significant changes when nothing changed". Test 3 duplicates "detects a lesson disappearing ... as deleted" / "lists videos under deleted lessons" |
| apps/local/app/services/changelog-service.test.ts                        | 22    | 0.0s    | keep        | medium |                   | Diff rendering, clip-existence rules, draft filtering and the null-authoringStatus fix (751021fa) are real                                                                                                                                                                                               |
| apps/local/app/services/clip-mockup-asset-response.test.ts               | 13    | 0.0s    | keep        | high   |                   | HTTP Range semantics and path containment (a security guard)                                                                                                                                                                                                                                             |
| apps/local/app/services/clip-mockup-copy-forward.test.ts                 | 6     | 2.2s    | trim        | medium | done (batch 4)    | The fresh-lineageId test only asserts a precondition of duplicateVideo. The others guard the copy                                                                                                                                                                                                        |
| apps/local/app/services/clip-mockup-speech-service.test.ts               | 16    | 0.0s    | trim        | high   | done (batch 1, 4) | WAV header has a fix provenance (ce135e89). "agrees with itself" is implied by the explicit header test. The same-words determinism test is near-tautological                                                                                                                                            |
| apps/local/app/services/clip-service-effect-clips.test.ts                | 5     | 0.9s    | trim        | high   | done (batch 1, 4) | "after a clip" is subsumed by "between two existing clips". The field-values test re-states effectClipDefaults                                                                                                                                                                                           |
| apps/local/app/services/clip-service-handler.failures.test.ts            | 2     | 0.0s    | keep        | high   |                   | Effect typed-failure convention guard (tagged errors, not defects)                                                                                                                                                                                                                                       |
| apps/local/app/services/clip-service-insertion-point.test.ts             | 6     | 1.2s    | keep        | high   | done (batch 4)    | Optimistic insertion-point resolution is non-trivial logic                                                                                                                                                                                                                                               |
| apps/local/app/services/clip-service-obs.test.ts                         | 11    | 1.4s    | keep        | medium | done (batch 4)    | Dedup tolerance boundaries (0.57s drift vs over 0.6s) and the mutex are real rules                                                                                                                                                                                                                       |
| apps/local/app/services/clip-service-sections.test.ts                    | 10    | 1.5s    | trim        | medium | done (batch 4)    | The adjacent-section move is covered by the second half of "preserves ordering when moving a section up past another section". updateChapter is a one-column setter                                                                                                                                      |
| apps/local/app/services/clip-service-selection-move.test.ts              | 5     | 1.0s    | trim        | medium | done (batch 4)    | The clip-only and chapter-only move tests are subsumed by "move mode with mixed selection archives all selected originals"                                                                                                                                                                               |
| apps/local/app/services/clip-service-selection.test.ts                   | 9     | 1.2s    | trim        | high   | done (batch 1, 4) | The single-clip, mixed and select-all tests near-duplicate the first test and the relative-order test (which is already mixed)                                                                                                                                                                           |
| apps/local/app/services/clip-service-timeline.test.ts                    | 16    | 1.7s    | trim        | medium | done (batch 4)    | createVideo field echo, sorted-by-order (subsumed by the interleaved test), single-vs-multiple archive duplicate, and a pause setter already covered by updateClips                                                                                                                                      |
| apps/local/app/services/clips-race.test.ts                               | 4     | 0.9s    | keep        | high   |                   | Regression for #1403. The FOR UPDATE SQL asserts are the only feasible guard on the lock                                                                                                                                                                                                                 |
| apps/local/app/services/cloudinary-markdown-service.test.ts              | 9     | 0.1s    | trim        | high   | done (batch 1, 4) | "handles mixed local and http images" already covers http skip, multiple images, alt text and path resolution. The existsSync call-assert is an implementation detail                                                                                                                                    |
| apps/local/app/services/course-editor-service-beats.test.ts              | 4     | 1.2s    | trim        | medium | done (batch 4)    | "clears the description back to empty" is the same setter with ""                                                                                                                                                                                                                                        |
| apps/local/app/services/course-editor-service-lessons.test.ts            | 23    | 2.2s    | trim        | high   | done (batch 1, 4) | Many "real lesson" near-duplicates, single-column setters, and "returns early" tests that assert nothing about returning early                                                                                                                                                                           |
| apps/local/app/services/course-editor-service-sections.test.ts           | 16    | 2.0s    | trim        | high   | done (batch 1)    | A literal duplicate title, a "returns early" test that asserts nothing, archive near-duplicates, and a "real sections" reorder duplicate                                                                                                                                                                 |
| apps/local/app/services/course-publish-bundle-address.test.ts            | 6     | 0.0s    | keep        | high   |                   | The right seam for the Bundle-address rule (ADR 0023/0029). Integration tests elsewhere should defer to it                                                                                                                                                                                               |
| apps/local/app/services/course-publish-dropbox-placeholder.test.ts       | 7     | 1.8s    | trim        | high   | done (batch 1, 4) | "re-addresses the bundle when the floor moves" duplicates the pure computeBundleAddress test. The rest is real resume/syllabus behaviour                                                                                                                                                                 |
| apps/local/app/services/course-publish-dropbox-sync.test.ts              | 14    | 3.7s    | trim        | high   | done (batch 1, 4) | 5 tests duplicate course-publish-dropbox-upload.test.ts at the same seam. It also carries its own copy of the seeding harness (see consolidate)                                                                                                                                                          |
| apps/local/app/services/course-publish-dropbox-upload-reuse.test.ts      | 6     | 6.3s    | keep        | high   |                   | Reuse plan, Byte Hash and concurrency of copy vs upload are real                                                                                                                                                                                                                                         |
| apps/local/app/services/course-publish-dropbox-upload.test.ts            | 12    | 5.5s    | trim        | medium | done (batch 4)    | "still fails when a Video in the bundle does not match" is a weaker copy of dropbox-sync "rejects bundle corruption without moving the commit marker"                                                                                                                                                    |
| apps/local/app/services/course-publish-export-events.test.ts             | 4     | 0.0s    | keep        | high   |                   | Queue order and failure collection                                                                                                                                                                                                                                                                       |
| apps/local/app/services/course-publish-service-batch-export.test.ts      | 6     | 1.4s    | consolidate | high   | done (batch 4)    | The tests are good (longest-first, ADR 0029 withholding). About 200 lines of setup are a verbatim copy of course-publish-service.test.ts's; switch both to course-publish-service-test-setup.ts                                                                                                          |
| apps/local/app/services/course-publish-service-overlay-composite.test.ts | 21    | 2.9s    | trim        | medium | done (batch 4)    | 7 tests re-check pure hash/placement rules already pinned in overlay-compositing, overlay-render-cache and export-hash (the edit-case loop is 4 rows)                                                                                                                                                    |
| apps/local/app/services/course-publish-service-pipeline.test.ts          | 4     | 2.0s    | keep        | high   | done (batch 4)    | Export/upload overlap, independent pool budgets, GC after upload                                                                                                                                                                                                                                         |
| apps/local/app/services/course-publish-service-publish.test.ts           | 9     | 1.9s    | trim        | high   | done (batch 1)    | "fails with PublishValidationError when export fails after retries" is a strict subset of "emits a per-video error event and still fails with PublishValidationError"                                                                                                                                    |
| apps/local/app/services/course-publish-service-reexport.test.ts          | 3     | 2.6s    | trim        | medium | done (batch 4)    | The manifest-SHA256 test duplicates dropbox-upload "re-derives the manifest's SHA256 from the bytes that actually shipped"                                                                                                                                                                               |
| apps/local/app/services/course-publish-service-reuse-fallback.test.ts    | 2     | 2.4s    | keep        | medium | done (batch 4)    | Distinct GC-then-copy-fallback scenario. It redefines isVideoUploadRequest/remoteBundleVideoPaths, which the dropbox-upload-test-setup already exports                                                                                                                                                   |
| apps/local/app/services/course-publish-service-short-export.test.ts      | 4     | 1.9s    | trim        | high   | done (batch 1)    | "accepts longer" and "refuses zero-length" re-test isExportUnacceptablyShort, which has the same cases. The wiring is already proven by the first two tests                                                                                                                                              |
| apps/local/app/services/course-publish-service-stale-export.test.ts      | 5     | 1.7s    | keep        | high   |                   | Regression for truncated exports that survived on disk                                                                                                                                                                                                                                                   |
| apps/local/app/services/course-publish-service-submit-order.test.ts      | 3     | 1.2s    | keep        | high   |                   | Submit-before-export ordering and Discard-on-failure are core version-integrity rules                                                                                                                                                                                                                    |
| apps/local/app/services/course-publish-service-syllabus-only.test.ts     | 4     | 1.1s    | keep        | medium | done (batch 4)    | Syllabus-only release end to end. The refused-commit test overlaps publish's Discard test but adds Draft preservation                                                                                                                                                                                    |
| apps/local/app/services/course-publish-service-video-tasks.test.ts       | 5     | 1.8s    | trim        | medium | done (batch 4)    | "emits per-Video upload events even when nothing needs exporting" is covered by the roster and already-exported tests                                                                                                                                                                                    |
| apps/local/app/services/course-publish-service.test.ts                   | 15    | 2.2s    | trim        | high   | done (batch 1, 4) | Video-object overload duplicates, two "integration" tests that just chain two existing tests, and an 80-line re-setup for a lint rule that lesson-warnings owns. Also consolidate its setup (see below)                                                                                                  |
| apps/local/app/services/cover-video-opening.test.ts                      | 5     | 0.0s    | keep        | high   |                   | Regression fix (63b0a9d6)                                                                                                                                                                                                                                                                                |
| apps/local/app/services/document-writing-agent.test.ts                   | 8     | 0.0s    | keep        | medium |                   | Prompt-cache layout rules with an explained past bug                                                                                                                                                                                                                                                     |
| apps/local/app/services/dropbox-upload-config.test.ts                    | 6     | 0.0s    | trim        | medium | done (batch 4)    | The defaults restate constants. The env read is Effect Config behaviour, and dropbox-upload "never exceeds the configured concurrency limit" covers it. Keep the validation and MB-to-bytes tests                                                                                                        |
| apps/local/app/services/export-duration-check.test.ts                    | 11    | 0.0s    | trim        | medium | done (batch 4)    | Tolerance boundaries are pinned by "exactly" and "more than". "less than" adds nothing                                                                                                                                                                                                                   |
| apps/local/app/services/export-hash-camera-version.test.ts               | 3     | 0.0s    | trim        | high   | done (batch 1)    | "keeps the two Kinds at different addresses" duplicates export-hash "changing an Overlay's kind changes the address"                                                                                                                                                                                     |
| apps/local/app/services/export-hash-overlay-animation.test.ts            | 3     | 0.0s    | trim        | high   | done (batch 1)    | "leave the address alone when neither is set" compares card() with an explicit copy of its own defaults (identical inputs)                                                                                                                                                                               |
| apps/local/app/services/export-hash.test.ts                              | 36    | 0.0s    | trim        | high   | done (batch 1, 4) | Tautologies (identical inputs, `EXPORT_VERSION === 1`), a duplicated pinned-literal test, determinism and format checks, and string-concat/path.join mirrors                                                                                                                                             |
| apps/local/app/services/export-sha256-sidecar.test.ts                    | 18    | 0.1s    | keep        | high   |                   | Cache-miss parsing (it.each = 9 rows) and sidecar repair are data-integrity rules                                                                                                                                                                                                                        |
| apps/local/app/services/ffmpeg-log-capture.test.ts                       | 6     | 0.0s    | trim        | medium | done (batch 4)    | The default-limit test restates MAX_STDERR_TAIL_CHARS                                                                                                                                                                                                                                                    |
| apps/local/app/services/ffmpeg-progress.test.ts                          | 9     | 0.0s    | keep        | high   |                   | Streaming parser edge cases                                                                                                                                                                                                                                                                              |
| apps/local/app/services/ffmpeg-video-logger.test.ts                      | 3     | 0.0s    | keep        | medium |                   | Never-throw guards from fix 1bcc9b6f                                                                                                                                                                                                                                                                     |
| apps/local/app/services/footage-chunking.test.ts                         | 15    | 0.0s    | keep        | high   |                   | Chunk planning and transcript offset/slicing logic                                                                                                                                                                                                                                                       |
| apps/local/app/services/format-failure-cause.test.ts                     | 5     | 0.0s    | keep        | high   |                   | Cause-walking edge cases (cycles, unstringifiable)                                                                                                                                                                                                                                                       |
| apps/local/app/services/lesson-warnings.test.ts                          | 33    | 0.0s    | trim        | high   | done (batch 1, 4) | computeCourseViewLintCount is literally `collectCourseViewLints(...).length`, so its 5 tests re-test collect. Several role/numbered-name near-duplicates                                                                                                                                                 |
| apps/local/app/services/oauth-token-refresh.test.ts                      | 4     | 0.0s    | keep        | high   |                   | Expiry window and error mapping                                                                                                                                                                                                                                                                          |
| apps/local/app/services/overlay-composite-ffmpeg-graph.test.ts           | 5     | 0.8s    | keep        | high   |                   | Runs the graph through real ffmpeg (#1594 regression)                                                                                                                                                                                                                                                    |
| apps/local/app/services/overlay-compositing.test.ts                      | 35    | 0.0s    | keep        | medium |                   | Placement and filtergraph rules. The right seam that the publish-level overlay tests should defer to                                                                                                                                                                                                     |
| apps/local/app/services/overlay-content-renderer.test.ts                 | 16    | 0.0s    | trim        | medium | done (batch 4)    | Keep the cross-package constant guards and schema tests. Drop the duplicated frame-size test and the pass-through field mappings                                                                                                                                                                         |
| apps/local/app/services/overlay-render-cache.server.test.ts              | 9     | 0.1s    | keep        | medium |                   | Cache hit/miss, version invalidation, .mov scratch-name fix (f8895f6b)                                                                                                                                                                                                                                   |
| apps/local/app/services/overlay-render-cache.test.ts                     | 26    | 0.0s    | trim        | high   | done (batch 1, 4) | Hex-format, determinism and current-version tautologies, a duplicated version-bump test, and filename/path.join mirrors. Keep the hash-sensitivity and legacy-address tests                                                                                                                              |
| apps/local/app/services/pending-recovery.test.ts                         | 6     | 1.2s    | keep        | high   |                   | Recovery classification (#1404)                                                                                                                                                                                                                                                                          |
| apps/local/app/services/remove-best-effort.test.ts                       | 3     | 0.0s    | keep        | medium |                   | Small, and covers the swallow-but-log contract                                                                                                                                                                                                                                                           |
| apps/local/app/services/render-vertical-video-service.test.ts            | 6     | 1.0s    | keep        | medium |                   | Subtitle phrase splitting is real logic                                                                                                                                                                                                                                                                  |
| apps/local/app/services/route-action.server.test.ts                      | 26    | 0.0s    | trim        | high   | done (batch 1, 4) | makeLoader and makeAction share buildErrorPipeline. The loader re-runs most of the action's error-mapping tests. "no backup coupling" is byte-identical to "returns success value"                                                                                                                       |
| apps/local/app/services/silence-detection.test.ts                        | 4     | 0.0s    | trim        | medium | done (batch 4)    | startTime=0 duplicates "startTime not provided". The negative silence_start regression stays                                                                                                                                                                                                             |
| apps/local/app/services/text-generation-service.test.ts                  | 7     | 0.0s    | keep        | medium |                   | The retry classification is the rule. Could be parametrised but nothing is redundant                                                                                                                                                                                                                     |
| apps/local/app/services/version-lifecycle.test.ts                        | 7     | 1.3s    | keep        | high   |                   | Draft/Pending/Published guards and write-closure                                                                                                                                                                                                                                                         |
| apps/local/app/services/video-chapters.test.ts                           | 11    | 0.0s    | keep        | high   |                   | Chapter algorithm incl. byte-order sort and editor/DB agreement                                                                                                                                                                                                                                          |
| apps/local/app/services/video-concatenation-service.test.ts              | 7     | 1.4s    | keep        | high   |                   | Ordering/chapters plus the format fix (6aecbb65)                                                                                                                                                                                                                                                         |
| apps/local/app/services/video-files.test.ts                              | 20    | 0.2s    | trim        | medium | done (batch 4)    | http-vs-https duplicates and path.join mirrors. Keep the store, containment and the duplicate fix (09ae30f6)                                                                                                                                                                                             |
| apps/local/app/services/video-posting-context.server.test.ts             | 14    | 2.0s    | trim        | medium | done (batch 4)    | The two pitchId tests only ever assert null (they would pass if hard-coded). The file-listing tests duplicate video-files listVideoFiles                                                                                                                                                                 |
| apps/local/app/services/video-warnings.test.ts                           | 17    | 0.0s    | keep        | high   |                   | missingChapters ordering/archival rules and body/description rules                                                                                                                                                                                                                                       |
| apps/local/app/services/web-file-stream.test.ts                          | 5     | 0.0s    | keep        | high   |                   | Regression fix (47f2e009): undici wrapping and cancel                                                                                                                                                                                                                                                    |
| apps/local/app/services/youtube-upload-service.test.ts                   | 2     | 0.0s    | trim        | medium | done (batch 4)    | The two tests are the same parameter echo. Keep the `false` case, which is the one that overrides YouTube's default                                                                                                                                                                                      |

### Trim details

#### apps/local/app/services/beat-learning-goal-warnings.test.ts

- "is false for a section with no learning goals": sectionHasLearningGoals is `learningGoals.length > 0`; the test mirrors it
- "is true once a section has at least one learning goal": same

#### apps/local/app/services/buffer-posting-orchestration.server.test.ts

- "creates row before upload and sets remoteId after createPost": the happy-path test already asserts the row's remoteId/postedAt; this only swaps the id literal

#### apps/local/app/services/clip-mockup-copy-forward.test.ts

- "gives the duplicate a fresh lineageId — the reason the files must move": asserts a precondition of duplicateVideo, not the copy-forward behaviour

#### apps/local/app/services/clip-mockup-speech-service.test.ts

- "agrees with itself: byte rate is block align times sample rate": "writes a format chunk a decoder will accept" already pins every header field explicitly
- "is the same file for the same words": determinism check on a hash function; low value (medium)

#### apps/local/app/services/clip-service-effect-clips.test.ts

- "creates an effect clip after a clip": subsumed by "inserts effect clip between two existing clips with correct ordering"
- "creates an effect clip with correct field values": re-states effectClipDefaults back (medium)

#### apps/local/app/services/clip-service-sections.test.ts

- "moves a section up past an adjacent section (no clips between)": the second step of "preserves ordering when moving a section up past another section" does exactly this
- "updates the name of a chapter": single-column setter pass-through

#### apps/local/app/services/clip-service-selection-move.test.ts

- "move mode creates a new video AND archives originals from source": subsumed by "move mode with mixed selection archives all selected originals"
- "move mode archives original chapters from source": same

#### apps/local/app/services/clip-service-selection.test.ts

- "selecting a single clip creates a valid new video": a weaker copy of "copy mode creates a new video with selected clips, originals remain in source"
- "mixed selection creates a new video with all selected items": "items in new video preserve their relative order from source timeline" is a mixed selection with stronger asserts
- "selecting all items creates a new video with everything": same rule as the two above with a different literal (medium)

#### apps/local/app/services/clip-service-timeline.test.ts

- "creates a standalone video": echoes the input title and lessonId null (medium)
- "returns clips sorted by order": subsumed by "returns clips and sections interleaved and sorted" (medium)
- "archives a single clip": subsumed by "archives multiple clips"
- "updates pause type for a single clip": single-column setter; pauseType is already covered by "updates scene, profile, and pauseType for a clip" (medium)

#### apps/local/app/services/cloudinary-markdown-service.test.ts

- "preserves alt text": "handles mixed local and http images" asserts full bodies with alt text
- "processes multiple images": the mixed test uploads two images and checks both
- "resolves relative paths from base directory": asserts a mocked existsSync call (implementation detail); the mixed test's uploadedFilePaths already pins path.resolve(base, rel)
- "skips http URLs": the mixed test covers http skip (medium)

#### apps/local/app/services/course-editor-service-beats.test.ts

- "clears the description back to empty": the same setter called with "" (medium)

#### apps/local/app/services/course-editor-service-lessons.test.ts

- "returns early when slug is unchanged": asserts the same result shape as a rename and nothing about returning early
- "creates a real lesson even when the course has no filePath": only asserts success:true; "creates a real lesson in a section with a parseable path" covers creation (medium)
- "real lesson starts with authoringStatus 'todo'": "marks a todo lesson as done" already asserts a createLesson lesson starts todo
- "updates the description": single-column setter pass-through (medium)
- "updates the icon": single-column setter pass-through (medium)
- "updates the priority": single-column setter pass-through (medium)
- "updates dependencies array": single-column setter pass-through (medium)
- "soft-deletes a real lesson without renumbering siblings": never asserts the siblings' order, so it is a copy of "soft-deletes a lesson (sets archived, not removed from DB)"
- "reorders real lessons by updating order values only": same assert as "reorders lessons by updating order field"
- "moves a real lesson to an empty section and updates paths via planner": never asserts a path, so it is a copy of "moves a lesson to another section"
- "set-lesson-authoring-status round-trips between done and todo": the union of "marks a todo lesson as done" and "marks a done lesson back to todo"

#### apps/local/app/services/course-editor-service-sections.test.ts

- "renames a section by storing the new title verbatim" (the SECOND one, line ~150): a literal duplicate title and rule; it only varies how the section was created
- "returns early when the new title matches the current title": asserts nothing about returning early
- "archives a section even when it has real lessons": subsumed by "archives a section and lessons are preserved (not deleted)"
- "archives a section with lessons": same
- "reorders real sections by updating order values only": same rule and assert as "reorders sections by updating order field"

#### apps/local/app/services/course-publish-dropbox-placeholder.test.ts

- "re-addresses the bundle when the floor moves": course-publish-bundle-address "re-addresses the bundle when the Placeholder Floor moves" pins the rule at the pure seam

#### apps/local/app/services/course-publish-dropbox-sync.test.ts

- "uploads video files to Dropbox": subsumed by "uploads videos for all lessons"
- "verifies existing bundle integrity via content_hash + size": same as dropbox-upload "uploads zero Videos when re-publishing an unchanged Course Version"
- "emits per-lesson progress events": weaker copy of dropbox-upload "reports monotonic progress with several uploads in flight"
- "course.json uses lineageId as correlation id": only asserts `id` is defined and non-empty; never checks it is the lineageId (medium)
- "course.json includes the render-input hash and exported byte receipt": covered by dropbox-upload "keeps every Video's SHA256 and byte count in the shipped manifest" (medium)

#### apps/local/app/services/course-publish-dropbox-upload.test.ts

- "still fails when a Video in the bundle does not match its expected bytes": dropbox-sync "rejects bundle corruption without moving the commit marker" is the same scenario and also checks the receipt is untouched (medium)

#### apps/local/app/services/course-publish-service-overlay-composite.test.ts

- "counts a long Pause on a preceding Clip": overlay-compositing "counts a preceding Clip's long Pause as part of the timeline" is the right seam
- "gives a Definition Card and a Bullet Panel of the same title different renders": overlay-render-cache "never collides with a Definition Card of the same title and duration"
- "re-exports to a new address when a bullet's icon is edited" (edit-case row): keep one representative row ("a bullet's text"); field sensitivity is pinned in overlay-render-cache (medium)
- "re-exports to a new address when a bullet's revealAt is edited" (edit-case row): same (medium)
- "re-exports to a new address when the panel's heading is edited" (edit-case row): same (medium)
- "re-exports to a new address when an Animation Toggle is set": pinned by export-hash-overlay-animation and overlay-render-cache "each Animation Toggle changes the hash" (medium)
- "addresses each render by its content, under the Course": same wiring as "asks the cache for the panel's own content, bullets and all" (medium)

#### apps/local/app/services/course-publish-service-publish.test.ts

- "fails with PublishValidationError when export fails after retries": strict subset of "emits a per-video error event and still fails with PublishValidationError" (same setup, same asserts plus more)

#### apps/local/app/services/course-publish-service-reexport.test.ts

- "records the re-exported file's SHA256 in the manifest": dropbox-upload "re-derives the manifest's SHA256 from the bytes that actually shipped" pins the same rule one seam down (medium)

#### apps/local/app/services/course-publish-service-short-export.test.ts

- "accepts an export longer than its Clips ask for": export-duration-check has the identical case at the pure seam
- "refuses a zero-length export": export-duration-check "refuses a zero-length export, however little was expected"; wiring is proven by "fails the Publish and names the Video whose export was short"

#### apps/local/app/services/course-publish-service-video-tasks.test.ts

- "emits per-Video upload events even when nothing needs exporting": covered by "names every shipping Video in the upload roster, exported or not" and "queues an already-exported Video for upload without waiting on any encode" (medium)

#### apps/local/app/services/course-publish-service.test.ts

- "accepts a video object and returns false when no file exists": overload near-duplicate of the id variant (medium)
- "accepts a video object and returns true when file exists": same (medium)
- "accepts a video object and returns content-addressed path": same (medium)
- "isExported returns true after exportVideo": just chains "exports video to content-addressed path" and the isExported tests
- "validatePublishability passes after all videos exported": the same as "returns empty list when all videos are exported" plus "returns unexported video IDs..."
- "returns courseViewLintCount including lesson warnings for invalid video-role combos": 80 lines of hand-rolled re-setup to re-test a lesson-warnings rule; the wiring is proven by "returns courseViewLintCount > 0 when missingChapters warning exists" (medium)

#### apps/local/app/services/dropbox-upload-config.test.ts

- "defaults upload concurrency to 4": restates a constant; dropbox-upload "uploads several Videos at once, up to the default limit of 4" covers it in behaviour
- "reads upload concurrency from DROPBOX_UPLOAD_CONCURRENCY": Effect Config behaviour; dropbox-upload "never exceeds the configured concurrency limit" covers it end to end (medium)
- "defaults the upload chunk size to 16 MB": restates a constant (medium)

#### apps/local/app/services/export-duration-check.test.ts

- "accepts an export short by less than the tolerance": the boundary is pinned by "short by exactly the tolerance" and "short by more than the tolerance" (medium)

#### apps/local/app/services/export-hash-camera-version.test.ts

- "keeps the two Kinds at different addresses": export-hash "changing an Overlay's kind changes the address"

#### apps/local/app/services/export-hash-overlay-animation.test.ts

- "leave the address alone when neither is set": card() already defaults both to false, so it compares identical inputs

#### apps/local/app/services/export-hash.test.ts

- "transcript text changes do not affect the hash": both inputs are identical (no text field at all); pure tautology
- "changing EXPORT_VERSION would change hashes": asserts `hash` is truthy and `EXPORT_VERSION === 1`
- "leaves the address of a clip with no Overlays untouched": the same input and same pinned literal as "leaves the address of a clip without a long pause untouched"; one pin is enough
- "is deterministic for the same input": determinism of sha256; the pinned-literal test already proves stability (medium)
- "returns a 32-char hex string for clips": the pinned literal already proves the format (medium)
- "returns {courseId}-{hash}.mp4": string concatenation mirrored (medium)
- "returns absolute path in finished videos directory": path.join mirrored (medium)

#### apps/local/app/services/ffmpeg-log-capture.test.ts

- "defaults to MAX_STDERR_TAIL_CHARS when no limit is given": restates the constant (medium)

#### apps/local/app/services/lesson-warnings.test.ts

- "returns solution for 'Solution 2'": same rule as "returns explainer for 'Explainer 2'" (medium)
- "does not flag the bare role name 'Explainer'": the same input and assert as "returns no warnings for {explainer}"
- "flags 'Explainer 1' as a numbered role name (canonical is 'Explainer')": near-duplicate of "flags 'Explainer 2' alone..."; Explainer 1 is also in the combo test (medium)
- "returns 0 for empty sections": computeCourseViewLintCount is `collectCourseViewLints(...).length` (medium)
- "returns 0 for a valid explainer lesson with chapters": same (medium)
- "counts lesson warnings for invalid role combos": re-tests collect via .length; "tags a lesson-level lint..." covers it
- "counts video warnings for missing chapters": re-tests collect; "tags a video-level lint..." covers it
- "sums warnings across multiple lessons and videos": "count is exactly the number of itemised lints" uses the same fixture

#### apps/local/app/services/overlay-content-renderer.test.ts

- "renders at the landscape export frame" (Bullet Panels describe): duplicate of the Definition Cards one; both restate OVERLAY_RENDER_FRAME
- "carries the card's own words": one-line field mapping (medium)
- "carries both Animation Toggles": one-line field mapping (medium)

#### apps/local/app/services/overlay-render-cache.test.ts

- "returns a 32-char hex string" (Bullet Panels describe): the format is identical to cards and pinned by the legacy-hash test
- "returns a 32-char hex string" (Definition Cards describe): pinned by "keeps the address every card cached before Bullet Panels existed had" (medium)
- "is stable for the same content" (Definition Cards describe): determinism of a hash (medium)
- "is stable for the same content" (Bullet Panels describe): same (medium)
- "hashes at the current Overlay Renderer Version": computeOverlayContentHash is atVersion(current); a tautology
- "bumping the Overlay Renderer Version changes the hash" (Bullet Panels describe): duplicate of the card one; the version is not kind-specific
- "names the file {courseId}-{contentHash}.mov": string concatenation mirrored
- "puts the render in the cache directory": path.join mirrored (medium)
- "gives identical content under the same course one path": determinism (medium)
- "gives a Bullet Panel a path of the same shape": path.join mirrored (medium)

#### apps/local/app/services/route-action.server.test.ts

- "runs an action whose effect needs no services on an empty runtime": byte-identical body to makeAction "returns success value when effect succeeds"
- makeLoader "passes params to the effect": pass-through, same as makeAction's (medium)
- makeLoader "maps ParseError to 400 by default": same buildErrorPipeline; only the map literal differs (medium)
- makeLoader "maps custom error tags to configured status codes": shared buildErrorPipeline, already tested via makeAction
- makeLoader "maps an error tag with no configured status to 500": same
- makeLoader "propagates Effect.die from inside the effect as-is": same
- makeLoader "custom errors extend rather than replace default mappings": same as makeAction "custom errors extend rather than replace the default map"
- makeLoader "logs error cause via Console.dir on error": same pipeline; console spy

#### apps/local/app/services/silence-detection.test.ts

- "does not adjust timestamps when startTime is 0": same expected output as "returns clips without offset when startTime is not provided" (medium)

#### apps/local/app/services/video-files.test.ts

- "returns URL as-is when filename is an http URL": duplicate of the https case
- "returns true for http URLs": duplicate of the https case (medium)
- "joins local filename with lineageId directory": path.join mirror, asserting only toContain (medium)

#### apps/local/app/services/video-posting-context.server.test.ts

- "returns null pitchId for standalone videos": only ever asserts null; it would pass with pitchId hard-coded to null (medium)
- "returns null pitchId for lesson videos": same (medium)
- "returns files from lineageId-keyed dir for lesson-bound videos": defaultEnabled is already pinned by the standalone test and video-files "decides defaultEnabled from the basename" (medium)
- "returns empty files array when directory does not exist": video-files listVideoFiles "returns an empty array when the video has no directory" (medium)

#### apps/local/app/services/youtube-upload-service.test.ts

- "includes notifySubscribers=true in the initiation URL when set": the same parameter echo as the false case (medium)

### Delete details

#### apps/local/app/services/changelog-service-empty-sections.test.ts (3 tests)

- "does not report changes when versions only differ by a removed empty section": its own comment says the fixture holds no empty section, which makes it identical to changelog-service "shows no significant changes when nothing changed"
- "returns no spurious changes for matching real sections": the same fixture again, through detectChanges
- "correctly detects a deleted lesson when its only reference was from an empty section": plain lesson removal, covered by changelog-service "detects a lesson disappearing (section lost its path) as deleted" and "lists videos under deleted lessons"

### Consolidate details

#### apps/local/app/services/course-publish-service-batch-export.test.ts and apps/local/app/services/course-publish-service.test.ts

- Both carry a verbatim ~200-line `setup()` (PGlite seed, mock VideoProcessingService, layers). batch-export's header comment claims a "per-file harness convention", but the other 12 course-publish-service-*.test.ts files already share `setupPublishableCourse` from apps/local/app/services/course-publish-service-test-setup.ts. Move both onto it (it already supports `mockVideoProcessing`, `videoCount` and per-run render overrides). batch-export's `addVideo`/`runBatchExport` helpers stay local.
- course-publish-service.test.ts's last test hand-rolls a third copy of the layer stack. It goes away if the trim above is taken.

#### apps/local/app/services/course-publish-dropbox-sync.test.ts

- `setupSync` is a fourth copy of the seed and Dropbox-auth harness. Move it onto `setupUploads` in apps/local/app/services/course-publish-dropbox-upload-test-setup.ts, which already seeds Dropbox auth and the fake Dropbox. The 9 surviving tests then sit naturally beside course-publish-dropbox-upload.test.ts.

#### apps/local/app/services/course-publish-service-reuse-fallback.test.ts, course-publish-service-syllabus-only.test.ts, course-publish-dropbox-placeholder.test.ts, course-publish-service-pipeline.test.ts

- Each redefines `isVideoUploadRequest`, `remoteBundleVideoPaths` or `receiptManifest` locally. All three are already exported from apps/local/app/services/course-publish-dropbox-upload-test-setup.ts. Import them; no tests change.

#### clip-service-{sections,timeline,selection,selection-move,insertion-point,obs,effect-clips}.test.ts

- All 7 open with the same ~65-line harness (PGlite, createDirectClipService, the start/afterClip/afterSection/getItems helpers); 4 distinct md5s, differing only by one `end` constant. Extract it to apps/local/app/services/clip-service-test-setup.ts, mirroring course-editor-service-test-setup.ts. No test cases change. About 400 lines removed.

#### apps/local/app/services/export-hash-overlay-animation.test.ts and export-hash-camera-version.test.ts

- Both say they were split out of export-hash.test.ts only for a per-file token budget. After the trims above export-hash.test.ts loses about 7 tests, which may make room to fold the surviving 2 + 2 back in. Optional, low confidence.

## Area C: apps/local CLI, lib, hooks, prompts, course-json

| file                                                                     | tests                | runtime | verdict     | conf   | status            | reason                                                                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------- | ------- | ----------- | ------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/local/app/cli/cli-beat-writes.test.ts                               | 30                   | 4.0s    | trim        | medium | done (batch 2)    | CLI flag/exit wiring is worth keeping, but ordering/not-found/LG-set rules are re-verified from packages/core/services/db-beat-operations.test.ts                       |
| apps/local/app/cli/cli-chapter-writes.test.ts                            | 18                   | 3.1s    | trim        | medium | done (batch 2)    | only guard on chapter writes; drop empty-list/variadic-get output-contract dupes and a repeat-append dupe                                                               |
| apps/local/app/cli/cli-clip-archived-view.test.ts                        | 4                    | 1.1s    | keep        | high   |                   | --archived get/list visibility rule, only guard                                                                                                                         |
| apps/local/app/cli/cli-clip-mockup-capture.test.ts                       | 6 (+it.each rows)    | 0.9s    | keep        | high   |                   | capture verb arg parsing, sheet ordering, exit 4 — genuine CLI behaviour                                                                                                |
| apps/local/app/cli/cli-clip-mockup-chapter.order-space.test.ts           | 9                    | 2.4s    | keep        | high   |                   | shared order space (mockups + chapters), delete-absorbs rule — business rules                                                                                           |
| apps/local/app/cli/cli-clip-mockup-chapter.test.ts                       | 21                   | 3.2s    | trim        | medium | done (batch 2)    | keep anchors/move-requires-anchor/not-local; drop generic output-contract and repeated both-anchors tests                                                               |
| apps/local/app/cli/cli-clip-mockup-comment.test.ts                       | 5                    | 1.4s    | keep        | medium |                   | small; one-parent flag rule + round trip; service also covered in core but CLI flag parsing is its own                                                                  |
| apps/local/app/cli/cli-clip-mockup-html-capture.test.ts                  | 14                   | 2.1s    | trim        | high   | done (batch 1, 2) | keep capture/atomicity rules; one test asserts a constant equals itself, one duplicates the no-picture rule in writes                                                   |
| apps/local/app/cli/cli-clip-mockup-ordering.test.ts                      | 33                   | 5.6s    | trim        | medium | done (batch 2)    | position addressing is CLI-only logic (keep); one html+image test duplicates html-capture                                                                               |
| apps/local/app/cli/cli-clip-mockup-speech.test.ts                        | 12                   | 2.3s    | keep        | medium |                   | speech caching/dedup/failure atomicity rules                                                                                                                            |
| apps/local/app/cli/cli-clip-mockup-store-location.test.ts                | 5                    | 1.3s    | keep        | high   |                   | regression for fix 6523461d (CLIP_MOCKUP_DIR from repo .env)                                                                                                            |
| apps/local/app/cli/cli-clip-mockup-writes.test.ts                        | 27                   | 3.6s    | trim        | medium | done (batch 2)    | keep batch validation/atomicity; drop output-contract dupes and ordering rules already in core db-clip-mockup-operations.test.ts                                        |
| apps/local/app/cli/cli-clip-restore.test.ts                              | 4                    | 1.2s    | keep        | high   |                   | restore semantics, only guard                                                                                                                                           |
| apps/local/app/cli/cli-clip-retime-cascade.test.ts                       | 16                   | 2.9s    | trim        | medium | done (batch 2)    | keep DB wiring + neighbour isolation + rollback; pure shift/drop/clamp variants are already in packages/core/features/videos/retime-cascade.test.ts                     |
| apps/local/app/cli/cli-clip-words.test.ts                                | 13                   | 2.2s    | keep        | medium |                   | transcript-word persistence and re-transcribe replacement, only guard                                                                                                   |
| apps/local/app/cli/cli-clip-writes.test.ts                               | 27                   | 3.6s    | trim        | low    | done (batch 2)    | mostly real rules (min length, stale transcript, cross-video); one chapter-anchor near-dup                                                                              |
| apps/local/app/cli/cli-course-publish-placeholders.test.ts               | 3 (+it.each rows)    | 2.1s    | keep        | high   |                   | band validation + manifest/readiness agreement                                                                                                                          |
| apps/local/app/cli/cli-course-readiness.test.ts                          | 19                   | 2.4s    | keep        | high   |                   | publish-readiness rules; includes regression for fix 751021fa (null authoringStatus)                                                                                    |
| apps/local/app/cli/cli-deliverable-writes.test.ts                        | 21                   | 2.8s    | trim        | medium | done (batch 2)    | keep link/date/status rules; drop framework required-flag test and two archive near-dupes                                                                               |
| apps/local/app/cli/cli-entity-links.test.ts                              | 7                    | 1.5s    | keep        | high   |                   | link-as-id parsing is pure CLI behaviour                                                                                                                                |
| apps/local/app/cli/cli-error-round-trip.test.ts                          | 14                   | 2.0s    | keep        | medium |                   | per-group wire error contract; deliberately one per group (each group declares its own error schema)                                                                    |
| apps/local/app/cli/cli-file-writes.test.ts                               | 14                   | 2.2s    | trim        | medium | done (batch 2)    | real fs rules (clobber, escape, --as); drop empty-list output-contract dupe                                                                                             |
| apps/local/app/cli/cli-footage-writes.test.ts                            | 9                    | 0.9s    | trim        | medium | done (batch 2)    | sidecar/staleness rules kept; drop empty-dir output-contract dupe                                                                                                       |
| apps/local/app/cli/cli-integration.test.ts                               | 43                   | 5.0s    | trim        | low    | done (batch 2)    | the canonical output/exit-code contract file (keep); two display-name tests re-test helpers.test.ts fallbacks                                                           |
| apps/local/app/cli/cli-layer.test.ts                                     | 3 (+it.each GROUPS)  | 0.1s    | keep        | high   |                   | RPC round trip per group: path, arg order, bearer, schema header                                                                                                        |
| apps/local/app/cli/cli-learning-goal-writes.test.ts                      | 24                   | 3.5s    | trim        | medium | done (batch 2)    | same as beats: ordering/unlink/not-found rules duplicated in packages/core/services/db-learning-goal-operations.test.ts                                                 |
| apps/local/app/cli/cli-lesson-move-update.test.ts                        | 24                   | 2.9s    | consolidate | medium | done (batch 2)    | lesson update tests overlap cli-lesson-video-writes "lesson update"; drop the --description block's repeated not-found/published tests                                  |
| apps/local/app/cli/cli-lesson-video-writes.test.ts                       | 46                   | 4.4s    | trim        | medium | done (batch 2)    | video parent invariants are real; drop framework required-flag, duplicate no-field and lesson-update dupes of cli-lesson-move-update                                    |
| apps/local/app/cli/cli-local-only.test.ts                                | 14                   | 2.0s    | trim        | medium | done (batch 2)    | guard file (keep); three message/ordering tests repeat the same assertion on another noun                                                                               |
| apps/local/app/cli/cli-overlay-bullet-panel-writes.test.ts               | 26                   | 3.1s    | trim        | medium | done (batch 2)    | keep validation wiring + update re-validation; two timing rules re-verify packages/core/features/videos/bullet-panel.test.ts                                            |
| apps/local/app/cli/cli-overlay-kind-writes.test.ts                       | 13                   | 2.5s    | keep        | high   |                   | overlap rule only tested here                                                                                                                                           |
| apps/local/app/cli/cli-overlay-transform-writes.test.ts                  | 6                    | 1.8s    | keep        | high   |                   | camera-move vs zoom conflict rule, only guard                                                                                                                           |
| apps/local/app/cli/cli-overlay-writes.test.ts                            | 28                   | 3.9s    | trim        | medium | done (batch 2)    | offset/anchor rules kept; drop generic list/get output-contract dupes                                                                                                   |
| apps/local/app/cli/cli-pitch-beat-writes.test.ts                         | 20                   | 2.7s    | trim        | medium | done (batch 2)    | resolve-or-create video rule kept; drop framework missing-flag/unknown-flag tests                                                                                       |
| apps/local/app/cli/cli-remote-auth.test.ts                               | 9                    | 1.7s    | trim        | medium | done (batch 2)    | keep CLI-visible auth contract; token-state rules re-verify packages/core/services/db-api-token-operations.test.ts                                                      |
| apps/local/app/cli/cli-search.test.ts                                    | 36                   | 3.9s    | trim        | low    | done (batch 2)    | search service has no other test (keep most); a few scope/excerpt near-dupes                                                                                            |
| apps/local/app/cli/cli-section-lint.test.ts                              | 14                   | 2.2s    | keep        | high   |                   | lint rules, only guard                                                                                                                                                  |
| apps/local/app/cli/cli-section-writes.test.ts                            | 28                   | 3.1s    | trim        | low    | done (batch 2)    | draft-guard per verb is real; one repeated both-anchors test                                                                                                            |
| apps/local/app/cli/cli-tree-slim.test.ts                                 | 5                    | 1.7s    | keep        | medium |                   | default slim vs --full output shape is CLI behaviour                                                                                                                    |
| apps/local/app/cli/cli-version-gate.test.ts                              | 7                    | 1.7s    | keep        | medium |                   | schema gate end-to-end incl. writes-nothing; older/newer both matter (!= vs <)                                                                                          |
| apps/local/app/cli/cli-video-archive.test.ts                             | 6                    | 1.2s    | keep        | medium |                   | CLI maps re-archive to exit 3 (service is idempotent) — distinct behaviour                                                                                              |
| apps/local/app/cli/commands/course-publish.test.ts                       | 2 (it.each, 20 rows) | 0.0s    | keep        | high   |                   | version-name parser                                                                                                                                                     |
| apps/local/app/cli/helpers.test.ts                                       | 9                    | 0.0s    | keep        | high   |                   | displayName fallback chain — the unit seam                                                                                                                              |
| apps/local/app/hooks/should-ignore-keyboard-shortcut.test.ts             | 11                   | 0.0s    | trim        | medium |                   | real rule; one near-duplicate                                                                                                                                           |
| apps/local/app/hooks/use-banned-phrases.test.ts                          | 5                    | 0.0s    | keep        | high   |                   | parser; regression from fix 9d7f2ff8                                                                                                                                    |
| apps/local/app/hooks/use-local-storage.test.ts                           | 9                    | 0.0s    | keep        | high   |                   | parser + key-change + SSR guard                                                                                                                                         |
| apps/local/app/hooks/use-upload-revalidate.test.ts                       | 7                    | 0.0s    | keep        | low    |                   | small pure transition rule; tests are cheap                                                                                                                             |
| apps/local/app/lib/clip-web-link.test.ts                                 | 7                    | 0.0s    | keep        | high   |                   | URL rules                                                                                                                                                               |
| apps/local/app/lib/create-sse-response.server.test.ts                    | 9                    | 0.0s    | trim        | medium |                   | framing/error fallbacks real; header test restates constants                                                                                                            |
| apps/local/app/lib/diagram-action-resolver.test.ts                       | 17                   | 0.0s    | trim        | medium |                   | walk-back rule real; two empty-items cases duplicate start/end cases                                                                                                    |
| apps/local/app/lib/filtered-newest-snapshot.test.ts                      | 12                   | 0.0s    | keep        | high   |                   | visibility + newest selection, the right seam                                                                                                                           |
| apps/local/app/lib/focus-tracker.test.ts                                 | 6                    | 0.0s    | keep        | low    |                   | tiny observable; per-tracker isolation guards the merge refactor                                                                                                        |
| apps/local/app/lib/popup-channel.test.ts                                 | 13                   | 0.3s    | trim        | medium |                   | keep routing/open-state rules; drop subsumed and pass-through tests                                                                                                     |
| apps/local/app/lib/queue-tree.test.ts                                    | 4                    | 0.0s    | delete      | medium |                   | trivial map+push; tests mirror the code                                                                                                                                 |
| apps/local/app/lib/semver.test.ts                                        | 10                   | 0.0s    | trim        | medium |                   | real parser (used by publish route); two zero-version near-dupes                                                                                                        |
| apps/local/app/lib/short-status.test.ts                                  | 4                    | 0.0s    | keep        | high   |                   | regression for fix ef699080                                                                                                                                             |
| apps/local/app/lib/short-title.test.ts                                   | 2                    | 0.0s    | keep        | low    |                   | one regex, but it is the only guard on "default title" detection                                                                                                        |
| apps/local/app/lib/spacedesk-ip.test.ts                                  | 7                    | 0.0s    | keep        | low    |                   | small validator, cheap                                                                                                                                                  |
| apps/local/app/lib/timeline-visibility.test.ts                           | 9                    | 0.0s    | delete      | medium |                   | one-liner `preserved \                                                                                                                                                  | \   | some(!archived)`; same truth table already in filtered-newest-snapshot.test.ts (which calls it) |
| apps/local/app/lib/video-breadcrumb.test.ts                              | 2                    | 0.0s    | delete      | high   | done (batch 1)    | string concatenation; test mirrors the template                                                                                                                         |
| apps/local/app/packages/course-json/tests/course-json-validation.test.ts | 27                   | 0.0s    | trim        | medium |                   | role/gap rules real; two near-dupes of effective-sections / each other                                                                                                  |
| apps/local/app/packages/course-json/tests/course-json.test.ts            | 22                   | 0.0s    | trim        | medium |                   | schema/role/receipt rules real; trivial top-level mapping + three copy-paste lineageId tests                                                                            |
| apps/local/app/packages/course-json/tests/effective-sections.test.ts     | 14                   | 0.0s    | keep        | high   |                   | the unit seam for withholding rules                                                                                                                                     |
| apps/local/app/packages/course-json/tests/lesson-publish-status.test.ts  | 10 (+it.each rows)   | 0.0s    | trim        | high   | done (batch 1)    | classification real; one test restates a constant array                                                                                                                 |
| apps/local/app/prompts/animatic-instructions.test.ts                     | 4                    | 0.0s    | trim        | high   | done (batch 1)    | literal-substring asserts on prompt text                                                                                                                                |
| apps/local/app/prompts/beats-instructions.test.ts                        | 6                    | 0.0s    | trim        | high   | done (batch 1)    | literal-substring asserts on prompt text                                                                                                                                |
| apps/local/app/prompts/script-instructions.test.ts                       | 7                    | 0.0s    | trim        | high   | done (batch 1)    | literal-substring asserts on prompt text                                                                                                                                |
| apps/local/app/prompts/source-hierarchy.test.ts                          | 21                   | 0.0s    | delete      | high   | done (batch 1)    | every test asserts a constant string contains a literal                                                                                                                 |
| apps/local/app/prompts/transcript-instructions.test.ts                   | 5                    | 0.0s    | trim        | high   | done (batch 1)    | literal-substring asserts on prompt text                                                                                                                                |
| apps/local/app/tests/api.courses.$courseId.duplicate.test.ts             | 3                    | 1.0s    | delete      | high   | done (batch 1)    | tests a copy of the route logic re-written inside the test file, not the route; name guard is covered in packages/core/services/db-course-operations-name-guard.test.ts |
| apps/local/app/tests/video-routes-fullscreen.test.ts                     | 4 (loops, ~21 cases) | 0.0s    | keep        | medium |                   | convention guard on route handles (fix 01ed9d1f)                                                                                                                        |
| apps/local/components/ui/kibo-ui/ai/removable-block.test.ts              | 7                    | 0.0s    | keep        | high   |                   | source-range rule                                                                                                                                                       |
| apps/local/components/ui/kibo-ui/ai/response.test.tsx                    | 2                    | 0.0s    | keep        | medium |                   | wiring check that custom-component blocks get no remove button                                                                                                          |

### Trim details

#### apps/local/app/cli/cli-beat-writes.test.ts

- "add accepts --kind setup" — same flag path as "add accepts --kind, --title and --description atomically", just another enum literal
- "update never repositions or changes the beat's video" — service rule; update has no position input
- "add echoes an empty learningGoalIds for a brand-new beat" — core "starts with no Learning Goals" plus the first test's echo
- "update --learning-goal (repeated) attaches every id given" — repeated-flag parsing already covered by "add --learning-goal (repeated)"; set semantics in core setBeatLearningGoals
- "add --before an unknown beat id => NotFoundError, exit 2" — core "fails when beforeBeatId does not exist"; move's unknown-anchor test covers the CLI path
- "update an unknown id => NotFoundError, exit 2" — same rule as "any write on an already-deleted beat"
- "delete an unknown id => NotFoundError, exit 2" — same as above

#### apps/local/app/cli/cli-learning-goal-writes.test.ts

- "create --before an unknown goal id => NotFoundError, exit 2" — core "fails when beforeLearningGoalId does not exist"
- "update never repositions the goal" — no position input on update
- "update an unknown id => NotFoundError, exit 2" — dup of "any write on an already-deleted goal" / core
- "delete an unknown id => NotFoundError, exit 2" — same
- "update --unlink-beat is idempotent when the Beat was never linked" — core "is idempotent when the Beat was never linked"
- "update --unlink-beat on an unknown Learning Goal id => NotFoundError, exit 2" — core "fails when the Learning Goal does not exist"
- "move to the end when no anchor is passed" — core "appends to the end when beforeLearningGoalId is null"

#### apps/local/app/cli/cli-chapter-writes.test.ts

- "appends to the end across multiple adds" — same as "adds a chapter with the given title, appended by default"
- "list prints nothing (exit 0) for a video with no chapters" — shared emitNdjson contract, covered in cli-integration "empty list prints nothing and exits 0"
- "get is variadic and reports missing ids on stderr (exit 2)" — shared emitGet contract, covered in cli-integration "multi-id get partial failure"

#### apps/local/app/cli/cli-clip-mockup-chapter.test.ts

- "list of a Video with no Chapters prints nothing and exits 0" — shared output contract (cli-integration)
- "get of one id prints one pretty object" — shared emitGet contract (cli-integration "single get emits exactly one (pretty) object")
- "get of many ids prints NDJSON and names the missing ones on stderr" — shared emitGet contract (cli-integration)
- "move with both anchors is invalid input" — same rejectBothFlags call as "both --before and --after is invalid input"

#### apps/local/app/cli/cli-clip-mockup-html-capture.test.ts

- "captures at exactly 1920x1080" — `expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([1920, 1080])`, a constant asserted against itself
- "add with an entry holding NEITHER html nor image is invalid input, exit 3" — same rule as cli-clip-mockup-writes "add with an entry that has no picture is invalid input, exit 3"

#### apps/local/app/cli/cli-clip-mockup-ordering.test.ts

- "update with both an html page and an image is invalid input, exit 3" — same as html-capture "update with BOTH html and image is invalid input, exit 3, and changes nothing" (which is stronger)

#### apps/local/app/cli/cli-clip-mockup-writes.test.ts

- "add appends a second call after the first" — core db-clip-mockup-operations "appends a second run after the first"
- "add places a chapter entry between the moments either side of it" — core "places a Chapter entry between the moments either side of it"
- "list of a Video with no Clip Mockups prints nothing and exits 0" — shared output contract
- "get of one id echoes one pretty object" — shared emitGet contract
- "get is variadic: several ids emit NDJSON" — shared emitGet contract
- "get of several ids keeps stdout pure when one is missing" — shared emitGet contract (cli-integration "multi-id get partial failure")

#### apps/local/app/cli/cli-clip-retime-cascade.test.ts

- "shifts words forward when the in-point moves earlier" — core retime-cascade "extends offsets forward when the in-point moves earlier"
- "drops a word the trimmed tail no longer contains" — head-drop test already proves the DB delete wiring; tail rule in core
- "leaves every word shifted but otherwise untouched when none fall out" — core "shifts every word by the delta, keeping its text"
- "leaves the clip's own text and transcribedAt alone" — dup of cli-clip-writes "retimes both ends, leaving text/transcribedAt untouched"
- "clamps an anchor pushed off the end back to the clip's last moment" — front-clamp test proves wiring; end rule in core
- "leaves an in-bounds Overlay shifted but otherwise untouched" — core "shifts an in-bounds anchor and nothing more"

#### apps/local/app/cli/cli-clip-writes.test.ts

- "positions with --before a CHAPTER anchor" — same shared-order-space resolution as "positions with --after a CHAPTER anchor"

#### apps/local/app/cli/cli-deliverable-writes.test.ts

- "rejects a missing --title / --date => exit 3" — @effect/cli required-option behaviour; generic case already in cli-integration "CLI validation error (missing required flag)"
- "rejects an unknown id => exit 2" (deliverable archive) — same not-found path as update's "rejects an unknown id => exit 2"
- "is not repeatable — an archived deliverable is not addressable" — same rule as "treats an archived deliverable as absent => exit 2"

#### apps/local/app/cli/cli-file-writes.test.ts

- "prints nothing (exit 0) when the video has no files" — shared empty-list contract

#### apps/local/app/cli/cli-footage-writes.test.ts

- "prints nothing (exit 0) for an empty directory" — shared empty-list contract

#### apps/local/app/cli/cli-integration.test.ts

- "lesson list carries name = title" — title fallback is helpers.test.ts; section/video tests already prove withName wiring
- "pitch list carries name = title (the noun the report was about)" — same

#### apps/local/app/cli/cli-lesson-video-writes.test.ts

- "create with missing --name => invalid input, exit 3" — framework required-option behaviour
- "update with no --name => invalid input, exit 3" — near-dup of "update with no fields => invalid input, exit 3"
- "update --description on an unknown video => NotFoundError(video), exit 2" — same as "update an unknown video => NotFoundError(video), exit 2"
- "an empty --title => invalid input, exit 3" (lesson update) — dup of cli-lesson-move-update "rejects an empty title as invalid input (exit 3)"
- "update an unknown lesson => NotFoundError(lesson), exit 2" — dup of cli-lesson-move-update "reports a missing lesson as not-found (exit 2)"
- "--title only leaves the authoring status untouched" — partial-patch rule also in cli-lesson-move-update "leaves the title untouched (partial patch)"

#### apps/local/app/cli/cli-local-only.test.ts

- "refuses cvm clip-mockup ahead of its own argument validation" — same ordering rule as "refuses ahead of the command's own validation"
- "names the Clip Mockup directory as what cvm clip-mockup needed" — message literal; "names the resource it would have needed" covers the rule
- "names footage as the resource cvm footage would have needed" — same

#### apps/local/app/cli/cli-overlay-bullet-panel-writes.test.ts

- "refuses two bullets revealed at the same moment" — core bullet-panel "refuses two bullets revealed at the same moment"
- "gives a bullet a whole extra ease when the exit is a cut" — core "accepts a whole ease later when the exit is a cut"

#### apps/local/app/cli/cli-overlay-writes.test.ts

- "prints nothing for a Video with no Overlays" — shared empty-list contract
- "returns several Overlays as NDJSON" — shared emitGet contract
- "emits what it found and names what it did not" — shared emitGet contract

#### apps/local/app/cli/cli-pitch-beat-writes.test.ts

- "create with missing --title => invalid input, exit 3" — framework required-option behaviour
- "update rejects the retired --content-plan flag => exit 3" — unknown-option rejection is @effect/cli behaviour; the create one is enough to pin the retirement

#### apps/local/app/cli/cli-remote-auth.test.ts

- "fails when the token has expired" — core db-api-token-operations "rejects an expired token"; CLI-side indistinguishability covered by "says the same thing whichever it was"
- "fails when the token has been revoked" — same (core "rejects a revoked token")
- "advances lastUsedAt, so a token nobody needs is findable" — core "accepts a valid token and advances lastUsedAt"
- "leaves no trace on the token it rejected" — core "leaves lastUsedAt alone when the token is rejected"

#### apps/local/app/cli/cli-search.test.ts

- "archived section root => exit 2 NotFoundError" — same scoped-root archived rule as "archived scope root"
- "archived lesson root => exit 2 NotFoundError" — same
- "excerpts a long body with ellipses around the match" — same snippet function as "excerpts a long transcript with ellipses around the match"

#### apps/local/app/cli/cli-section-writes.test.ts

- "rejects both --before and --after (exit 3)" (section move) — same rejectBothFlags as create's "both --before and --after => invalid input, exit 3"

#### apps/local/app/hooks/should-ignore-keyboard-shortcut.test.ts

- "allows shortcuts when not inside a dialog" — same as "allows shortcuts for a generic element outside a dialog"

#### apps/local/app/lib/create-sse-response.server.test.ts

- "returns correct SSE headers" — restates three header constants

#### apps/local/app/lib/diagram-action-resolver.test.ts

- "returns home when start insertion point is used with empty items" — dup of "returns home when insertion point is start"
- "returns home when insertion point is end and items are empty" — dup of "returns home when insertion point is end and all clips have no pin"

#### apps/local/app/lib/popup-channel.test.ts

- "carries popup messages to the main app" — subsumed by "gives each side only the messages meant for it"
- "carries main-app messages to the popup" — same
- "opens a given url instead of the default" — pass-through of an argument to a mocked window.open

#### apps/local/app/lib/semver.test.ts

- "parses v0.0.0" — same parse rule as "parses a v-prefixed semver string"
- "bumps from v0.0.0" — same bump rules as the three bump tests

#### apps/local/app/packages/course-json/tests/course-json-validation.test.ts

- "includes faithful section title" — near-dup of "emits title on every section"
- "drops a section whose only lessons are withheld to-do lessons" — effective-sections "drops a section whose only lessons are withheld"

#### apps/local/app/packages/course-json/tests/course-json.test.ts

- "uses course id and name at the top level" — trivial field copy
- "uses lineageId as the lesson id" / "uses lineageId as the video id" — copy-paste of "uses lineageId as the section id"; fold all three into one test asserting the three ids

#### apps/local/app/packages/course-json/tests/lesson-publish-status.test.ts

- "offers exactly the four bands, in floor order" — `expect(PLACEHOLDER_FLOOR_BANDS).toEqual([...])`, restates the constant

#### apps/local/app/prompts/animatic-instructions.test.ts

- "wraps the Animatic in <animatic> tags under an Animatic heading" — mirrors the template
- "keeps mockup numbers from being cited as transcript clip indices" — prompt literal
- "tells the model to follow a comment about the output, and never quote the Animatic" — prompt literal
  (keep "returns empty string for no Animatic")

#### apps/local/app/prompts/beats-instructions.test.ts

- "returns empty string for empty beats" — whitespace test is a superset
- "wraps the beats in <beats> tags under a Beat Plan heading" — mirrors the template
- "demotes the beats to intended emphasis only" — prompt literal
- "tells the model a beat missing from the transcript was cut" — prompt literal
- "no longer presents the beats as the video's flow and structure" — prompt literal (negative)

#### apps/local/app/prompts/script-instructions.test.ts

- "returns empty string for empty script" — whitespace test is a superset
- "wraps the script in <script> tags under a Script heading" — mirrors the template
- "frames the script as the base the presenter improvised from" — prompt literal
- "restricts the script's authority to spelling and naming" — prompt literal
- "tells the model to drop script content absent from the transcript" — prompt literal
  (keep whitespace-empty and trailing-newline composability)

#### apps/local/app/prompts/transcript-instructions.test.ts

- "wraps transcript in <transcript> tags" — mirrors the template
- "includes on-screen annotation explanation" — prompt literal
- "uses custom preamble when provided" — parameter pass-through + literal
  (keep empty and trailing-newline)

### Consolidate details

#### apps/local/app/cli/cli-lesson-move-update.test.ts

- Target: keep this file as the home for `lesson update` tests and remove the duplicates from apps/local/app/cli/cli-lesson-video-writes.test.ts (listed under its trims). Within this file also drop:
  - "reports a missing lesson as not-found (exit 2)" in the `lesson update --description` block — same update verb and path as the --title block's not-found test
  - "refuses to edit a lesson in a published version (exit 3)" in the `lesson update --description` block — same draft-guard call as the --title block's test

#### apps/local/app/lib/timeline-visibility.test.ts -> apps/local/app/lib/filtered-newest-snapshot.test.ts

- The latter already runs the same truth table through `isVisibleInTimeline` ("applies the SAME visibility filter the timeline does" plus the preserved/archived cases), so deleting this file loses nothing.

#### Cross-file note: --before/--after mutual exclusion

- `rejectBothFlags` (apps/local/app/cli/helpers.ts) is shared; each noun file has one or more "both --before and --after => exit 3" tests. Recommendation applied above: one per noun file (the extra per-verb copies are trimmed). A further step would be one it.each over all verbs in cli-integration.test.ts, but that does not shrink the suite much.

## Area D: Video editor and article writer

| file                                                                                 | tests             | runtime | verdict     | conf   | status         | reason                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------- | ------- | ----------- | ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/local/app/features/article-writer/assistant-message.test.tsx                    | 1                 | 0.0s    | keep        | low    |                | Guards a real fix (1586ae7e) but asserts Tailwind class names in static markup; delete if being strict about markup tests                                                                                                                                                               |
| apps/local/app/features/article-writer/choose-screenshot-markdown.test.ts            | 7                 | 0.0s    | keep        | high   |                | Offset-mapping parser; preview removal correctness depends on it                                                                                                                                                                                                                        |
| apps/local/app/features/article-writer/choose-screenshot-mutations.test.ts           | 17                | 0.0s    | trim        | high   | done (batch 1) | hasUnresolvedScreenshots is a one-regex `.test()` tested 7 ways; one dup clipIndex case                                                                                                                                                                                                 |
| apps/local/app/features/article-writer/commit-map-components.test.tsx                | 9                 | 0.0s    | trim        | low    | done (batch 5) | Breach checks through the real renderer are worth it; "draws no buttons" is static-markup                                                                                                                                                                                               |
| apps/local/app/features/article-writer/commit-map-syntax.test.ts                     | 26                | 0.0s    | keep        | medium |                | Parser and lint rules, each test a distinct rule/edge (packageManager added in b1d63fce)                                                                                                                                                                                                |
| apps/local/app/features/article-writer/document-editing-engine.test.ts               | 28                | 0.0s    | trim        | medium | done (batch 5) | Core edit engine rules are good; ~10 are same-rule-different-position near-dups                                                                                                                                                                                                         |
| apps/local/app/features/article-writer/document-panel.test.tsx                       | 2                 | 0.0s    | keep        | medium |                | Regression for f9074d09 (paste racing the stream); asserts behavior (disabled), not layout                                                                                                                                                                                              |
| apps/local/app/features/article-writer/document-preview-markdown.test.ts             | 8                 | 0.0s    | keep        | high   |                | Preprocess and offset-map parser, distinct cases                                                                                                                                                                                                                                        |
| apps/local/app/features/article-writer/document-tool-calls.test.ts                   | 11                | 0.0s    | keep        | high   |                | Tool-call fold, including restored-conversation guard                                                                                                                                                                                                                                   |
| apps/local/app/features/article-writer/format-animatic-context.test.ts               | 4                 | 0.0s    | keep        | medium |                | Serialiser feeding the model; 4 distinct shapes                                                                                                                                                                                                                                         |
| apps/local/app/features/article-writer/format-beats-context.test.ts                  | 6                 | 0.0s    | trim        | medium | done (batch 5) | "multiple beats in order" subsumes the single-beat cases                                                                                                                                                                                                                                |
| apps/local/app/features/article-writer/lint-fix.test.ts                              | 18                | 0.0s    | keep        | medium |                | Deterministic heading fix + planner (fb12ed48); edge cases are real (don't empty a heading-only doc)                                                                                                                                                                                    |
| apps/local/app/features/article-writer/memory-autosaver.test.ts                      | 4                 | 0.0s    | keep        | high   |                | Regression for 76a31dc5 (skip unchanged saves)                                                                                                                                                                                                                                          |
| apps/local/app/features/article-writer/message-text-mutation.test.ts                 | 5                 | 0.0s    | keep        | high   |                | Regression for 41871098 (lost state during capture); race/rebase rules                                                                                                                                                                                                                  |
| apps/local/app/features/article-writer/quiz-ids.test.ts                              | 17                | 0.0s    | keep        | medium |                | Id collision/renaming rules; distinct cases                                                                                                                                                                                                                                             |
| apps/local/app/features/article-writer/quiz-lint.test.ts                             | 10 (it.each rows) | 0.0s    | keep        | high   |                | Heuristic lint; each row is a tuned threshold case                                                                                                                                                                                                                                      |
| apps/local/app/features/article-writer/quiz-syntax.test.ts                           | 22                | 0.0s    | keep        | medium |                | Quiz parser + validator contract; distinct rules                                                                                                                                                                                                                                        |
| apps/local/app/features/article-writer/remove-document-block.test.tsx                | 9                 | 0.0s    | trim        | medium | done (batch 5) | Its value is the render+offset-map chain; nested/quote/leading-heading cases have no screenshot tag, so mapping is identity and they duplicate remove-markdown-block                                                                                                                    |
| apps/local/app/features/article-writer/remove-markdown-block.test.ts                 | 12                | 0.0s    | keep        | high   |                | Pure block-removal rules (tight lists, indent, quote markers)                                                                                                                                                                                                                           |
| apps/local/app/features/article-writer/screenshot-navigation.test.ts                 | 20 (it.each rows) | 0.0s    | keep        | high   |                | Key handling + target picking rules                                                                                                                                                                                                                                                     |
| apps/local/app/features/article-writer/use-message-queue.test.ts                     | 19                | 0.0s    | trim        | medium | done (batch 5) | Capture-hold block is a regression (41871098); several status cases and the lifecycle walk are near-dups                                                                                                                                                                                |
| apps/local/app/features/article-writer/writable-field.test.ts                        | 13                | 0.0s    | consolidate | medium | done (batch 5) | Cancel tests re-implement the snapshot/restore loop inside the test (exercise no WritableField code); isolation and constrainModes tests duplicate writer-engine-utils; FIELD_MODES tests restate config. Move only "stores nothing but conversations" into writer-engine-utils.test.ts |
| apps/local/app/features/article-writer/write-utils.test.ts                           | 2                 | 0.0s    | keep        | medium |                | One-shot legacy purge; guards against wiping data twice                                                                                                                                                                                                                                 |
| apps/local/app/features/article-writer/writer-engine-utils.test.ts                   | 17                | 0.0s    | trim        | high   | done (batch 1) | FIELD_MODES/FIELD_LABELS tests restate constants; one key test duplicates the storage isolation test                                                                                                                                                                                    |
| apps/local/app/features/article-writer/writer-url-state.test.ts                      | 7                 | 0.0s    | keep        | high   |                | URL state round-trips, fix provenance (8357635c)                                                                                                                                                                                                                                        |
| apps/local/app/features/video-editor/beat-tab.test.ts                                | 11                | 0.0s    | trim        | medium | done (batch 5) | Two-line rule ("persisted if exists, else script") tested 11 times                                                                                                                                                                                                                      |
| apps/local/app/features/video-editor/clip-state-reducer-chapters.test.ts             | 13                | 0.0s    | keep        | medium |                | Optimistic chapter lifecycle, insertion point, reorder effects                                                                                                                                                                                                                          |
| apps/local/app/features/video-editor/clip-state-reducer-deletion.test.ts             | 9                 | 0.0s    | keep        | medium |                | Insertion point after delete, archive-for-recovery rules                                                                                                                                                                                                                                |
| apps/local/app/features/video-editor/clip-state-reducer-diagram-pin.test.ts          | 6                 | 0.0s    | trim        | medium | done (batch 5) | Trivial map-and-assign case tested 6 ways                                                                                                                                                                                                                                               |
| apps/local/app/features/video-editor/clip-state-reducer-effect-clips.test.ts         | 11                | 0.0s    | trim        | high   | done (batch 1) | Two exact dups of the before/after tests; one restates WHITE_NOISE_DEFAULTS                                                                                                                                                                                                             |
| apps/local/app/features/video-editor/clip-state-reducer-insertion-point.test.ts      | 4                 | 0.0s    | keep        | medium |                | Long scenario tests of insertion semantics                                                                                                                                                                                                                                              |
| apps/local/app/features/video-editor/clip-state-reducer-permanent-removal.test.ts    | 11                | 0.0s    | keep        | medium |                | Data-removal scoping (per session, deleted bucket); integrity                                                                                                                                                                                                                           |
| apps/local/app/features/video-editor/clip-state-reducer-recording-handler.test.ts    | 10                | 0.0s    | delete      | high   | done (batch 1) | Tests the private sub-handler (handleRecordingAction/isRecordingAction); each case is duplicated at the public clipStateReducer seam in -recording, -session-clips, -transcription and -snapshot-pinning tests                                                                          |
| apps/local/app/features/video-editor/clip-state-reducer-recording.test.ts            | 21                | 0.0s    | trim        | medium | done (batch 5) | Session lifecycle is a keep; outputPath and "all sessions done" cases are subsumed by siblings                                                                                                                                                                                          |
| apps/local/app/features/video-editor/clip-state-reducer-section-ops.test.ts          | 10                | 0.0s    | keep        | medium |                | Clips vs sections interleaving, reorder effects                                                                                                                                                                                                                                         |
| apps/local/app/features/video-editor/clip-state-reducer-session-clips.test.ts        | 12                | 0.0s    | keep        | medium |                | Session association, restore, outputPath-scoped matching                                                                                                                                                                                                                                |
| apps/local/app/features/video-editor/clip-state-reducer-snapshot-pinning.test.ts     | 7                 | 0.0s    | keep        | medium |                | snapshot-for-clip emission branches                                                                                                                                                                                                                                                     |
| apps/local/app/features/video-editor/clip-state-reducer-transcription.test.ts        | 10                | 0.0s    | keep        | medium |                | Optimistic->DB pairing, archive transfer rules                                                                                                                                                                                                                                          |
| apps/local/app/features/video-editor/clip-state-reducer-web-links.test.ts            | 12                | 0.0s    | keep        | high   |                | Dwell-threshold capture rules, fix provenance (c2413f96)                                                                                                                                                                                                                                |
| apps/local/app/features/video-editor/components/editor-compact-header.test.tsx       | 2                 | 0.0s    | keep        | medium |                | Markup test, but pins the fix 01ed9d1f (same tab) and the only entry point into the Animatic                                                                                                                                                                                            |
| apps/local/app/features/video-editor/ensure-obs-profile.test.ts                      | 8                 | 0.0s    | trim        | medium | done (batch 5) | Stop->Set->Start order is a real OBS constraint; dups and a lookup-table pair add nothing                                                                                                                                                                                               |
| apps/local/app/features/video-editor/overlay-spill.test.ts                           | 9                 | 0.0s    | keep        | high   |                | Overlay carry-over across clips; business rule                                                                                                                                                                                                                                          |
| apps/local/app/features/video-editor/session-clip-marks.test.ts                      | 11                | 0.0s    | keep        | high   |                | Mark state derivation incl. real-take scenario                                                                                                                                                                                                                                          |
| apps/local/app/features/video-editor/session-latest-transcript.test.ts               | 5                 | 0.0s    | keep        | high   |                | Distinct selection rules                                                                                                                                                                                                                                                                |
| apps/local/app/features/video-editor/use-audio-boost.test.ts                         | 8                 | 0.0s    | delete      | high   | done (batch 1) | Never calls the hook: asserts Math.pow and that vi.fn mocks were called; Map get/set on the exported cache. Tautological despite the fix provenance (fcdc392c)                                                                                                                          |
| apps/local/app/features/video-editor/use-ensure-obs-profile.test.ts                  | 7                 | 0.0s    | keep        | medium |                | Gate state machine; regression 3d42e1d4 (no mid-recording switch)                                                                                                                                                                                                                       |
| apps/local/app/features/video-editor/video-editor-selectors-capture.test.ts          | 10                | 0.0s    | trim        | high   | done (batch 1) | Three-clause OR; combined cases add nothing                                                                                                                                                                                                                                             |
| apps/local/app/features/video-editor/video-editor-selectors-chapters.test.ts         | 11                | 0.0s    | trim        | medium | done (batch 5) | getChapterPercentComplete is a keep; trivial not-found/empty edges of getChapterForClip                                                                                                                                                                                                 |
| apps/local/app/features/video-editor/video-editor-selectors-clips.test.ts            | 44                | 0.0s    | trim        | high   | done (batch 1) | One-liner selectors (filter/findIndex/find/identity) tested exhaustively; keep insertion-point and video/livestream/scrub (f7f0cf65)                                                                                                                                                    |
| apps/local/app/features/video-editor/video-editor-selectors-danger-metadata.test.ts  | 48                | 0.0s    | trim        | high   | done (batch 1) | Many one-liner selectors and dup permutations; keep timecodes, levenshtein threshold, back-button (2cbbfd49)                                                                                                                                                                            |
| apps/local/app/features/video-editor/video-editor-selectors-recording-status.test.ts | 4                 | 0.0s    | trim        | high   | done (batch 1) | Pure function; last test re-asserts the previous one                                                                                                                                                                                                                                    |
| apps/local/app/features/video-editor/video-editor-selectors-retranscribe.test.ts     | 4                 | 0.0s    | trim        | medium | done (batch 5) | filter+map one-liner; one test (skip optimistic) carries the rule                                                                                                                                                                                                                       |
| apps/local/app/features/video-editor/video-editor-selectors-timeline.test.ts         | 32                | 0.0s    | trim        | high   | done (batch 1) | getSessionPanels is a keep (fixes 9201baa3, b8597e8e); one exact-duplicate test body plus getTimelineItems cases subsumed by "preserves order"                                                                                                                                          |
| apps/local/app/features/video-editor/video-state-reducer.test.ts                     | 15                | 0.0s    | trim        | medium | done (batch 5) | Shift-select regression (293d0df3) and scrub are keeps; two effect-payload pass-through dups                                                                                                                                                                                            |

### Trim details

#### apps/local/app/features/article-writer/choose-screenshot-mutations.test.ts

- "handles decrementing clipIndex": same as "updates clipIndex in a tag"
- "returns false for empty string": the regex is one `.test()` call, and the no-tags case already covers this
- "returns true with multiple tags": dup of "returns true when message contains ChooseScreenshot tags"
- "returns false when all tags have been replaced": dup of "returns false when no ChooseScreenshot tags exist"
- "detects unresolved tags in a full document with resolved images": same regex, larger literal
- "returns false for a full document where all screenshots are resolved": same regex, larger literal

#### apps/local/app/features/article-writer/commit-map-components.test.tsx

- "is static — it draws no buttons": asserts absent static markup

#### apps/local/app/features/article-writer/document-editing-engine.test.ts

- "replaces a full paragraph": same rule as "finds and replaces unique old_text with new_text"
- "replaces text at document start": position variant of the same indexOf/slice
- "replaces text at document end": position variant
- "inserts after anchor in the middle of document": dup of "inserts new_text immediately after the anchor"
- "inserts at document end when anchor is at the end": position variant
- "works with empty document": rewrite ignores input; dup of "replaces entire document with new_text"
- "adjacent edits work correctly": covered by "applies multiple edits sequentially"
- "handles empty document with replace (fails)": dup of "fails with descriptive error when old_text is not found"
- "replace with old_text matching entire document": position variant
- "insert_after at document start": position variant

#### apps/local/app/features/article-writer/format-beats-context.test.ts

- "formats a single beat with title and description": subsumed by "formats multiple beats in order"
- "formats a beat with title but no description": subsumed by "formats multiple beats in order" (beat 2 has no description)

#### apps/local/app/features/article-writer/remove-document-block.test.tsx

- "keeps the indentation of the sibling below a nested list item": no screenshot tag, so mapping is identity; dup of remove-markdown-block "takes the indent with a nested list item"
- "takes the quote marker when removing a blockquoted paragraph": dup of remove-markdown-block "takes the quote marker with a blockquoted paragraph"
- "removes the leading heading": precedes the tag (identity mapping); dup of remove-markdown-block "removes a heading along with the blank line that followed it"

#### apps/local/app/features/article-writer/use-message-queue.test.ts

- "queues when status is submitted": same branch as "queues when status is streaming"
- "does not drain when status is submitted": same branch as "does not drain when status is streaming"
- "drains only one message at a time": dup of "drains the first message when status is ready and queue is non-empty"
- "queues messages during streaming, then drains one by one on ready": composite of the unit cases above, adds no new rule

#### apps/local/app/features/article-writer/writer-engine-utils.test.ts

- "generates distinct message keys for different fields on the same video": covered behaviorally by "does not bleed between fields"
- "has modes defined for each field": restates config
- "has labels for all fields": restates FIELD_LABELS constants

#### apps/local/app/features/video-editor/beat-tab.test.ts

- "honours a persisted tab that still exists (reference)": same branch as the (beats) case
- "falls back to script when the persisted tab no longer exists (beats gone)": same branch as the (reference removed) case
- "defaults to script even when the video has beats": same as "defaults to script even when a reference is selected"
- "falls back to script when a stale beats tab was persisted and neither exists": same fallback branch
- "honours a persisted script tab (always available)": script always exists, so this is trivially the honour branch

#### apps/local/app/features/video-editor/clip-state-reducer-diagram-pin.test.ts

- "clears both fields when unpinning (setting null)": same assignment with null
- "overwrites an existing pin with a new one": same assignment
- "is a no-op when frontendId does not exist": generic map no-op
- "only updates the targeted clip when multiple clips exist": generic map; covered by the id check in "ignores optimistic clips"

#### apps/local/app/features/video-editor/clip-state-reducer-effect-clips.test.ts

- "works when inserting at the first position (before first clip)": exact dup of "inserts an optimistic effect clip before the target clip"
- "works when inserting at the last position (after last clip)": dup of "inserts ... after the target clip" plus "inserts between two existing clips"
- "has correct field values on the optimistic effect clip": restates WHITE_NOISE_DEFAULTS; the profile part is covered by "inherits profile from the adjacent clip"

#### apps/local/app/features/video-editor/clip-state-reducer-recording.test.ts

- "Should store the outputPath from the action": covered by "Should fire start-session-polling effect with sessionId and outputPath" and "Should store different outputPaths for different sessions"
- "Should preserve outputPath after recording stops": covered by "Should store different outputPaths for different sessions" (session 1 is polling there)
- "Should fire separate start-session-polling effects for each session": dup of the single-session effect test plus displayNumber increment
- "Should emit revalidate-loader when all sessions become done": subsumed by "Should emit revalidate-loader only when the last session becomes done"

#### apps/local/app/features/video-editor/ensure-obs-profile.test.ts

- "does not call CreateProfile for missing profiles": "returns error when target profile does not exist" already asserts only GetProfileList was called
- "switches from TikTok to Landscape Recording": direction variant of the switch test
- "returns Landscape Recording for standard format": lookup table
- "returns TikTok for short format": lookup table

#### apps/local/app/features/video-editor/video-editor-selectors-capture.test.ts

- "is false with no sessions, no clips, OBS not running": covered by "is false when fully idle..."
- "is true when recording with pending clips and an active session combined": all three clauses true at once; tests nothing new
- "stays true through settling: OBS idle but a clip is still pending after stop": polling session alone already makes it true ("is true when a session is polling/settling...")

#### apps/local/app/features/video-editor/video-editor-selectors-chapters.test.ts

- "returns undefined when clip is not found in items": trivial findIndex edge
- "returns undefined for empty items": trivial edge

#### apps/local/app/features/video-editor/video-editor-selectors-clips.test.ts

- "filters out chapters": one-line `filter(isClip)`
- "returns empty array for no clips": one-line filter
- "returns index of matching clip": findIndex pass-through
- "returns -1 when not found": findIndex pass-through
- "returns -1 for undefined": findIndex pass-through
- "returns first selected clip": `Array.from(set)[0]`
- "returns undefined for empty set": `Array.from(set)[0]`
- "deduplicates nothing (duplicates kept as in current behavior)": pins an incidental quirk, not a rule
- "returns 0 for empty array": reduce initial value
- "returns true when flag is set": getShowLastFrame is the identity function
- "returns false when flag is not set": identity function
- "finds the current clip": `clips.find` pass-through
- "returns undefined when not found": `clips.find` pass-through
- "returns true for empty array": `Array.every` semantics (third-party behavior)

#### apps/local/app/features/video-editor/video-editor-selectors-danger-metadata.test.ts

- "returns duration for on-database clips": getClipDuration is end minus start; already exercised via timecodes
- "returns null for optimistic clips" (getClipDuration): trivial branch
- "returns 0 for optimistic clips" (getClipPercentComplete): trivial falsy-duration branch
- "returns false for optimistic clips" (getIsClipPortrait): trivial type guard
- "returns false for optimistic clips" (getIsClipDangerous): trivial type guard
- "returns false for empty clips": `Array.some` on empty
- "returns null for empty array": trivial edge of getLastTranscribedClipId
- "filters items to chapters only": one-line `filter(isChapter)`
- "returns true when sections exist": `getChapters().length > 0`
- "returns false when no sections": same
- "returns false for empty array" (getHasSections): same
- "returns true when OBS is connected": 2-value type check, exercised by the LiveStreamPortrait/CenterLine tests
- "returns true when OBS is recording" (getIsOBSActive): same
- "returns false when OBS is not running" (getIsOBSActive): same
- "returns true when OBS is recording with TikTok profile": dup of the "active with TikTok" case
- "returns true when clip and showLastFrame are truthy": dup of "returns true regardless of scene match"
- "returns /videos when lessonId is missing": dup of "returns /videos when repoId is missing"
- "returns /videos when both are missing": dup
- "returns true when OBS is recording with Camera scene": dup of "returns true when OBS is active and scene is Camera"

#### apps/local/app/features/video-editor/video-editor-selectors-recording-status.test.ts

- "stays hidden when a take starts with the teleprompter already connected": pure function with no state; re-asserts "stays hidden while recording if the teleprompter is connected"

#### apps/local/app/features/video-editor/video-editor-selectors-retranscribe.test.ts

- "names every clip of the video that is already on the database": covered by the skip test's expected output
- "names an already-transcribed clip too — a re-transcribe redoes it": the selector never looks at text; tautological
- "is empty for a video with no clips": filter on empty

#### apps/local/app/features/video-editor/video-editor-selectors-timeline.test.ts

- "includes on-database clips": covered by "preserves order of remaining items"
- "includes chapters (on-database)": covered by "preserves order of remaining items"
- "returns empty array for empty input": trivial
- "returns empty array when all items are optimistic clips": dup of "excludes optimistically-added clips"
- "excludes non-recording sessions with no pending or archived clips": byte-identical body to "excludes non-recording sessions with no pending clips"
- "ignores non-optimistic items": dup of "ignores ClipOnDatabase without shouldArchive (main timeline clips)"
- "returns empty array when no sessions exist": trivial

#### apps/local/app/features/video-editor/video-state-reducer.test.ts

- "should dispatch create-video-from-selection effect with selected clip IDs, title, and mode": subsumed by "should separate clip IDs and chapter IDs in the effect payload"
- "should dispatch effect with move mode when specified": pass-through of the `mode` field

### Consolidate details

#### apps/local/app/features/article-writer/writable-field.test.ts -> apps/local/app/features/article-writer/writer-engine-utils.test.ts

- Move "stores nothing but conversations" (storage-key hygiene) into writer-engine-utils.test.ts under "field messages localStorage persistence" (it needs the `key(index)`-capable mock).
- Drop the rest:
  - "restores messages to their pre-open state on cancel", "restores messages across all modes on cancel" and "apply does not revert messages (only cancel does)" re-implement the snapshot loop inline and test only save/load.
  - The keying-isolation tests duplicate the key-distinctness and "does not bleed" tests.
  - The constrainModes tests duplicate writer-engine-utils' constrainModes block.
  - The FIELD_MODES membership tests restate config.
- Then delete writable-field.test.ts.

### Delete details

- apps/local/app/features/video-editor/clip-state-reducer-recording-handler.test.ts (10): the private seam is duplicated at the public reducer seam.
- apps/local/app/features/video-editor/use-audio-boost.test.ts (8): tautological. It never invokes useAudioBoost. If the Strict Mode fix (fcdc392c) needs a guard, write one real renderHook test that mounts twice and asserts createMediaElementSource is called once.

## Area E: Course view, upload manager, diagrams

| file                                                                         | tests              | runtime | verdict     | conf   | status                    | reason                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------ | ------- | ----------- | ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/local/app/features/course-view/collapsed-ids.test.ts                    | 10                 | 0.0s    | keep        | high   |                           | parser for persisted localStorage state + immutability; real edge cases                                                                                                                     |
| apps/local/app/features/course-view/course-editor-helpers.test.ts            | 49                 | 0.0s    | trim        | medium | done (batch 6)            | drop/reorder/stats logic is real (fix commits on authoringStatus); a few near-duplicate todo/order cases                                                                                    |
| apps/local/app/features/course-view/course-view-reducer-selection.test.ts    | 16                 | 0.0s    | trim        | high   | done (batch 1)            | toggle/prune rules are real; initial-state, plain clear setters and "doesn't affect other state" are tautological                                                                           |
| apps/local/app/features/course-view/course-view-reducer.test.ts              | 53                 | 0.0s    | trim        | high   | done (batch 1)            | ~80% are one-line setter/initial-state restatements; keep toggle-filter logic and insert-section clearing rule                                                                              |
| apps/local/app/features/course-view/course-view-visibility.test.ts           | 7                  | 0.0s    | keep        | high   |                           | cascade rules + tree/key integrity guard; fix provenance (94c517ae)                                                                                                                         |
| apps/local/app/features/course-view/course-warning-count.test.ts             | 2                  | 0.0s    | keep        | high   |                           | regression for fix #1688                                                                                                                                                                    |
| apps/local/app/features/course-view/dependency-drag.test.ts                  | 14                 | 0.0s    | trim        | medium | done (batch 6)            | cycle detection is real logic; two near-duplicates                                                                                                                                          |
| apps/local/app/features/course-view/lesson-description-field.test.tsx        | 8                  | 0.0s    | keep        | medium |                           | conditional render rules (compact/read-only), born from fix #1630 — not static markup                                                                                                       |
| apps/local/app/features/course-view/lesson-title-editor.test.ts              | 12                 | 0.0s    | trim        | high   | done (batch 1)            | 9 tests exercise copies of the logic defined inside the test file (makeSaveTitle, inline handledRef/onFocus) — tautological                                                                 |
| apps/local/app/features/course-view/optimistic-applier-beats.test.ts         | 13                 | 0.0s    | keep        | medium |                           | beat move/delete optimistic logic incl. cross-video move                                                                                                                                    |
| apps/local/app/features/course-view/optimistic-applier-composition.test.ts   | 17                 | 0.0s    | trim        | medium | done (batch 6)            | composition/last-write-wins real; several passthrough/undefined/no-lesson cases duplicate each other; key formatter is string concat                                                        |
| apps/local/app/features/course-view/optimistic-applier-delete-video.test.ts  | 11                 | 0.0s    | trim        | medium | done (batch 6)            | removal + reference equality real; empty-sections dup of not-found, key format dup                                                                                                          |
| apps/local/app/features/course-view/optimistic-applier-deletes.test.ts       | 11                 | 0.0s    | keep        | medium |                           | delete/archive with reference-equality (memo correctness)                                                                                                                                   |
| apps/local/app/features/course-view/optimistic-applier-reorders.test.ts      | 29                 | 0.0s    | keep        | medium |                           | reorder/move planner with fix provenance (d5999395 path corruption); defensive cases cheap                                                                                                  |
| apps/local/app/features/course-view/optimistic-applier.test.ts               | 26                 | 0.0s    | trim        | medium | done (batch 6)            | every patch event goes through the same withPatchedLesson/Section; "not found" repeated per event type and stale numeric-prefix variants                                                    |
| apps/local/app/features/course-view/section-grid-utils.test.ts               | 21                 | 0.0s    | trim        | medium | done (batch 6)            | filter/swap/dependency-runs real; three duplicates                                                                                                                                          |
| apps/local/app/features/course-view/section-script-field.test.tsx            | 6                  | 0.0s    | keep        | medium |                           | fold behaviour + valid-HTML (heading-not-in-button) rule                                                                                                                                    |
| apps/local/app/features/course-view/section-scripts-utils.test.ts            | 14                 | 0.0s    | keep        | high   |                           | document builder + preview truncation logic                                                                                                                                                 |
| apps/local/app/features/course-view/section-scripts-view.test.tsx            | 3                  | 0.0s    | keep        | low    |                           | small; fold-all control/empty state behaviour, not static markup                                                                                                                            |
| apps/local/app/features/course-view/section-title-editor.test.ts             | 4                  | 0.0s    | keep        | high   |                           | no-op/empty guards on rename event                                                                                                                                                          |
| apps/local/app/features/course-view/section-transcript-beats.test.ts         | 13                 | 0.0s    | keep        | medium |                           | serializer output across xml/md/json incl. escaping                                                                                                                                         |
| apps/local/app/features/course-view/section-transcript.test.ts               | 32                 | 0.0s    | keep        | medium |                           | serializer across three formats; minor overlap (3/3b/7) not worth churn                                                                                                                     |
| apps/local/app/features/course-view/use-lesson-dependency-drag.test.ts       | 8                  | 0.0s    | trim        | medium | done (batch 6)            | four tests just restate the dropAction→Tailwind-class table; keep precedence/empty                                                                                                          |
| apps/local/app/features/course-view/video-warning-indicator.test.tsx         | 6                  | 0.0s    | trim        | medium | done (batch 6)            | render rules real; two tests only re-test resolveEffectiveVisibility (already in course-view-visibility)                                                                                    |
| apps/local/app/features/diagrams/centre-camera-on-content.test.ts            | 11                 | 0.0s    | keep        | high   |                           | camera maths, fix provenance (#1556)                                                                                                                                                        |
| apps/local/app/features/diagrams/cvm-icon-shape.test.ts                      | 9                  | 0.0s    | trim        | medium | done (batch 6)            | load/validation/geometry guards real (doc-load hazard); defaults test restates config                                                                                                       |
| apps/local/app/features/diagrams/diagram-centering-settings.test.ts          | 8                  | 0.0s    | keep        | high   |                           | safe-area maths, fix #1556                                                                                                                                                                  |
| apps/local/app/features/diagrams/insert-onto-canvas.test.ts                  | 14                 | 0.0s    | keep        | high   |                           | migration-survival, size quantisation, shape-cap reporting                                                                                                                                  |
| apps/local/app/features/diagrams/palette/grid-nav.test.ts                    | 13                 | 0.0s    | keep        | medium |                           | keyboard grid navigation edge cases                                                                                                                                                         |
| apps/local/app/features/diagrams/palette/palette-model.test.ts               | 12                 | 0.0s    | keep        | high   |                           | visibility rules + data-integrity guards on ROOT_ACTIONS (unique ids, icons exist, pages exist)                                                                                             |
| apps/local/app/features/diagrams/palette/palette-nav.test.ts                 | 18                 | 0.0s    | keep        | medium |                           | page-stack/escape/backspace state machine                                                                                                                                                   |
| apps/local/app/features/diagrams/palette/palette-shortcuts.test.ts           | 6                  | 0.0s    | keep        | high   |                           | shortcut matching rules                                                                                                                                                                     |
| apps/local/app/features/diagrams/palette/recent-icons.test.ts                | 12                 | 0.0s    | keep        | high   |                           | storage robustness, MRU, cross-window merge                                                                                                                                                 |
| apps/local/app/features/diagrams/replace-icon.test.ts                        | 9                  | 0.0s    | keep        | medium |                           | selection rule + undo stopping point ordering (user-observable undo)                                                                                                                        |
| apps/local/app/features/diagrams/snapshot-list.test.ts                       | 5                  | 0.0s    | keep        | high   |                           | head-captured rule incl. clip-pinned                                                                                                                                                        |
| apps/local/app/features/diagrams/snapshot-navigation.test.ts                 | 21                 | 0.0s    | keep        | high   |                           | stepping/wrap/tie-break rules                                                                                                                                                               |
| apps/local/app/features/diagrams/snapshot-stepper.test.ts                    | 11                 | 0.0s    | keep        | high   |                           | async race guards (no double step, no stale write-back)                                                                                                                                     |
| apps/local/app/features/diagrams/use-recentre-diagram-shortcut.test.ts       | 3                  | 0.0s    | keep        | high   |                           | hotkey matcher, fix #1556                                                                                                                                                                   |
| apps/local/app/features/upload-manager/consume-sse-stream.test.ts            | 13                 | 0.7s    | trim        | medium | deleted (#1930)           | stream parsing/chunk-split real; two tests mirror fetch args / return type                                                                                                                  |
| apps/local/app/features/upload-manager/upload-eta-schedule.test.ts           | 9                  | 0.0s    | keep        | high   |                           | pool-replay scheduling logic                                                                                                                                                                |
| apps/local/app/features/upload-manager/upload-eta-stages.test.ts             | 1                  | 0.0s    | keep        | high   |                           | sync guard: client pool sizes must equal server runner constants                                                                                                                            |
| apps/local/app/features/upload-manager/upload-eta.test.ts                    | 15 (+it.each rows) | 0.0s    | keep        | high   |                           | ETA estimation logic                                                                                                                                                                        |
| apps/local/app/features/upload-manager/upload-history.test.ts                | 7                  | 0.0s    | keep        | high   | deleted (#1938)           | median/rate/robust parse                                                                                                                                                                    |
| apps/local/app/features/upload-manager/upload-manager-integration.test.ts    | 10                 | 0.0s    | trim        | high   | deleted (#1930)           | 6 tests drive `simulateEffect`, a copy of the effect written in the test; registry-completeness is enforced by the type system                                                              |
| apps/local/app/features/upload-manager/upload-reducer-autofill.test.ts       | 6                  | 0.0s    | keep        | high   | deleted (#1930)           | parent/child derivation rules                                                                                                                                                               |
| apps/local/app/features/upload-manager/upload-reducer-deps.test.ts           | 11                 | 0.0s    | trim        | high   | deleted (#1930)           | dependency chain rules real; "concurrent uploads" block is map-insertion trivia duplicated by generic tests                                                                                 |
| apps/local/app/features/upload-manager/upload-reducer-generic.test.ts        | 24                 | 0.0s    | trim        | medium | deleted (#1930)           | core state machine; drop "doesn't affect others" spread checks and a retry duplicate                                                                                                        |
| apps/local/app/features/upload-manager/upload-reducer-progress.test.ts       | 5                  | 0.0s    | keep        | high   | deleted (#1930)           | monotonic progress rules                                                                                                                                                                    |
| apps/local/app/features/upload-manager/upload-reducer-publish-videos.test.ts | 10                 | 0.0s    | keep        | high   | deleted (#1930)           | per-Video task + weighted progress rules                                                                                                                                                    |
| apps/local/app/features/upload-manager/upload-reducer-stages.test.ts         | 29                 | 0.0s    | trim        | low    | deleted (#1930)           | band/stage-type guards real; two same-seam duplicates                                                                                                                                       |
| apps/local/app/features/upload-manager/upload-reducer-timing.test.ts         | 11                 | 0.0s    | keep        | high   | deleted (#1930)           | timing/history recording rules                                                                                                                                                              |
| apps/local/app/features/upload-manager/upload-row.test.tsx                   | 19                 | 0.0s    | keep        | medium |                           | conditional rendering per status/stage/ETA; not static markup                                                                                                                               |
| apps/local/app/features/upload-manager/upload-selectors.test.ts              | 4                  | 0.0s    | keep        | high   | deleted (#1930)           | excludes Publish child tasks — real rule                                                                                                                                                    |
| apps/local/app/features/upload-manager/upload-toasts.test.ts                 | 2                  | 0.0s    | keep        | low    | deleted (#1926)           | Studio-link URL + omit when no id; mock-heavy but asserts real output                                                                                                                       |
| apps/local/app/features/upload-manager/upload-type-registry-pending.test.ts  | 3                  | 0.0s    | keep        | high   | deleted (sidecar batch 6) | publish errors terminal, child-task failure cascade                                                                                                                                         |
| apps/local/app/features/upload-manager/upload-type-registry-posting.test.ts  | 22                 | 0.0s    | consolidate | medium | deleted (#1930)           | 22 tests restate per-type field defaults and shared withAbortManagement/base-spread behaviour already covered; keep only "applySuccess stores slug" as rows in upload-type-registry.test.ts |
| apps/local/app/features/upload-manager/upload-type-registry.test.ts          | 27                 | 0.0s    | trim        | high   | deleted (#1930)           | per-type copies of the same shared behaviour (waiting preserved, error cleared, abort mgmt via shared withAbortManagement), "is registered"/flag restatements                               |

### Trim details

#### apps/local/app/features/course-view/course-editor-helpers.test.ts

- "preserves order for any mix of IDs (no special-casing)" — dup of "preserves relative order of selected lessons"
- "counts a todo lesson that has videos with clips as todo" — videos are irrelevant to todo count since authoringStatus refactor; dup
- "counts a lesson with authoringStatus todo" — identical setup/assert to "counts a todo lesson with no videos"
- "counts all todos regardless of priority" — no filter means no priority logic; dup
- "counts all-done lessons as 100% even with videos absent" — dup of "reaches 100% only when no lessons are todo"

#### apps/local/app/features/course-view/course-view-reducer-selection.test.ts

- "46. lessonSelection is null initially" — restates initial state
- "55. clear-lesson-selection: clears selection" — one-line setter
- "56. clear-lesson-selection: no-op when already null" — one-line setter
- "63. lesson selection does not affect other state" — tests object spread

#### apps/local/app/features/course-view/course-view-reducer.test.ts

Keep only: "33. toggle-priority-filter: adds priority when not present", "34. ... removes priority when already present", "36. ... removes one while keeping others", "38. toggle-icon-filter: removes icon when already present", "41. toggle-todo-filter: toggles back to false", "46. set-insert-section: opens modal and sets adjacent section state", "47. set-insert-section: after position", "48. set-create-section-modal-open clears insert section state", "49. closing create section modal clears insert section state", "60. clearing one filter leaves the others untouched". Remove (43) — all one-line setters/initial-state restatements/object-spread checks:

- "1. all modals are closed initially"
- "2. all ID-based selections are null initially"
- "3. video player is closed initially"
- "4. complex states are null initially"
- "5. filters are empty initially"
- "6. set-add-course-modal-open: opens the modal"
- "7. set-add-course-modal-open: closes the modal"
- "8. set-create-section-modal-open: toggles"
- "10. set-version-selector-modal-open: toggles"
- "12. set-rename-course-modal-open: toggles"
- "14. set-purge-exports-modal-open: toggles"
- "16. set-add-standalone-video-modal-open: toggles"
- "17. opening one modal does not affect others"
- "18. set-add-lesson-section-id: sets the section ID"
- "19. set-add-lesson-section-id: clears with null"
- "20. set-add-video-to-lesson-id: sets the lesson ID"
- "21. set-edit-lesson-id: sets and clears"
- "22b. set-delete-lesson-id: sets and clears"
- "23. open-video-player: opens with video info"
- "24. close-video-player: resets to initial state"
- "25. open-move-video: sets move video state"
- "26. close-move-video: clears move video state"
- "27. open-move-lesson: sets move lesson state"
- "28. close-move-lesson: clears move lesson state"
- "31. open-rename-video: sets rename video state"
- "32. close-rename-video: clears rename video state"
- "35. toggle-priority-filter: supports multiple priorities" — covered by 36
- "37. toggle-icon-filter: adds icon when not present" — same code shape as priority toggle
- "39. toggle-icon-filter: supports multiple icons" — same
- "40. toggle-todo-filter: toggles from false to true" — covered by 41
- "43. filters are independent of each other" — object spread
- "44. modal toggle does not affect filters" — object spread
- "45. opening video player does not affect modals" — object spread
- "50. set-edit-description-lesson-id: sets the lesson ID"
- "51. set-edit-description-lesson-id: clears with null"
- "52. open-lesson-body-writer: sets videoId"
- "53. close-lesson-body-writer: clears videoId"
- "54. lessonBodyWriterVideoId is null initially"
- "55. is closed initially"
- "56. set-visibility-settings-modal-open: opens and closes"
- "57. clear-priority-filter: empties the priority filter" — covered by 60
- "58. clear-icon-filter: empties the icon filter" — trivial setter
- "59. clear-todo-filter: resets the todo filter to false" — trivial setter

#### apps/local/app/features/course-view/dependency-drag.test.ts

- "adds dependency with empty initial dependencies" — dup of "adds dependency when target is not yet a dependency"
- "returns false for non-cyclic graph" — dup of "returns false when no path exists"

#### apps/local/app/features/course-view/lesson-title-editor.test.ts

All of these test logic re-implemented inside the test file (makeSaveTitle helper, inline handledRef/onFocus lambdas), never the component/hook — they cannot fail for a bug in the real code:

- "should allow blur-to-save after a previous Enter-to-save"
- "should NOT call onSave on blur after Escape cancels the session"
- "calls select() on the input element when focused"
- "submits update-lesson-title when title changes"
- "does not submit when title is the same as current"
- "does not submit when value only differs by surrounding whitespace"
- "preserves the user's exact casing rather than title-casing it"
- "falls back to lesson.path when title is empty — does not submit when value equals path"
- "submits multiple times when renamed repeatedly to different values"
  (If the saveTitle guard matters, extract it like buildSectionRenameEvent and test that.)

#### apps/local/app/features/course-view/optimistic-applier-composition.test.ts

- "returns loaderData unchanged for add-lesson" — same fall-through branch as create-section
- "returns loaderData unchanged for section events when selectedCourse is undefined" — dup of "undefined selectedCourse › returns loaderData unchanged"
- "returns loaderData unchanged when section has no lessons" — same seam as not-found
- "formats the key as course-editor:<type>:<id>" — string concat; covered by courseEditorFetcherKeyForEvent tests

#### apps/local/app/features/course-view/optimistic-applier-delete-video.test.ts

- "returns loaderData unchanged when sections array is empty" — dup of "videoId is not found"
- "formats the key with the delete-video prefix" — string concat; the startsWith-prefix test carries the contract

#### apps/local/app/features/course-view/optimistic-applier.test.ts

- update-lesson-title › "returns loaderData unchanged when lesson is not found" — same withPatchedLesson seam as update-lesson-icon's not-found
- update-lesson-description › "returns loaderData unchanged when lesson is not found" — same
- update-lesson-priority › "returns loaderData unchanged when lesson is not found" — same
- update-lesson-dependencies › "returns loaderData unchanged when lesson is not found" — same
- set-lesson-authoring-status › "returns loaderData unchanged when lesson is not found" — same
- update-section-description › "returns loaderData unchanged when section is not found" — same withPatchedSection seam as update-section-name
- "handles a lesson path without numeric prefix" — numeric prefix era is gone (d5999395); dup of "ignores whatever the lesson's previous path happened to be"
- "handles a new slug that contains hyphens" — same
  (Remaining one-line "patches X" tests could be a single test.each; optional.)

#### apps/local/app/features/course-view/section-grid-utils.test.ts

- "todo filter includes lesson with authoringStatus=todo" — dup of first todo-filter test
- "todo filter includes all priorities" — no priority filter applied; dup
- "works with two sections" — covered by up/down swap tests

#### apps/local/app/features/course-view/use-lesson-dependency-drag.test.ts

- "returns green ring for add action on drag target" — restates class table
- "returns amber ring for remove action on drag target" — restates class table
- "returns red ring for noop action on drag target" — restates class table
- "returns slate ring for existing dependency during drag" — restates class table

#### apps/local/app/features/course-view/video-warning-indicator.test.tsx

- "shows by default" — re-tests DEFAULT_VISIBILITY (course-view-visibility test 1)
- "hides with the Videos they hang off" — asserts only resolveEffectiveVisibility, never renders; dup of course-view-visibility test 3

#### apps/local/app/features/diagrams/cvm-icon-shape.test.ts

- "defaults to white, solid, and a square box" — restates getDefaultProps config

#### apps/local/app/features/upload-manager/consume-sse-stream.test.ts

_Deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to trim._

- "passes correct fetch options" — mirrors the fetch call
- "returns an AbortController" — type-level trivia

#### apps/local/app/features/upload-manager/upload-manager-integration.test.ts

_Deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to trim._

- "should recover params from unified map and call registry initiate on retry" — drives simulateEffect, a test-local copy of the real effect
- "should call initiate for each upload type with correct params" — same
- "should call initiate when dependency completes and status transitions from waiting to uploading" — same
- "should not call initiate when dependent fails due to dependency error cascade" — same (reducer half covered by deps "should fail dependent when dependency fails permanently")
- "should recover params for dependency-activated upload from unified param map" — same
- "should retry export type when paramsMap has no entry for the upload" — same
- "should have an entry for every upload type" — Record<UploadType,…> typing enforces it
  (Keep the 3 "full integration: reducer + registry through lifecycle" tests. If the effect wiring matters, extract it from upload-context and test the real function.)

#### apps/local/app/features/upload-manager/upload-reducer-deps.test.ts

_Deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to trim._

- "should handle starting multiple uploads" — map insertion
- "should handle mixed statuses across uploads" — composes generic UPLOAD_SUCCESS/UPLOAD_ERROR cases already tested
- "should handle concurrent uploads across different types" — dup of generic "should create type-specific entries via registry for each upload type"

#### apps/local/app/features/upload-manager/upload-reducer-generic.test.ts

_Deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to trim._

- START_UPLOAD › "should not affect existing uploads" — object spread
- UPDATE_PROGRESS › "should not affect other uploads" — object spread
- DISMISS › "should not affect other uploads" — object spread
- "should transition to retrying on second error" — dup of first-error case; boundary covered by "reaches 3"

#### apps/local/app/features/upload-manager/upload-reducer-stages.test.ts

_Deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to trim._

- "should update export stage to queued" — dup of "should update export stage for existing upload"
- "should transition from creating-post to polling" — dup of "should update buffer stage for existing upload"

#### apps/local/app/features/upload-manager/upload-type-registry.test.ts

_Deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to trim._

Keep: export createEntry/resetEntry/applySuccess (isBatchEntry/exportStage rules), youtube resetEntry (preserves youtubeVideoId), youtube applySuccess stores id, youtube initiate (wires startSSEUpload) and youtube "should abort existing controller before starting new one" (single copy of shared withAbortManagement), buffer createEntry/resetEntry/applySuccess stage rules. Remove (13):

- export › createEntry › "should preserve waiting status from base when dependsOn is set" — base spread, same for every type
- export › applySuccess › "should clear previous error message on success" — dup of generic "should clear any previous error message"
- youtube › "should be registered in the registry" — restatement
- youtube › "should have supportsDependsOn set to true" — restates config
- youtube › createEntry › "should create a youtube entry with youtubeVideoId null" — restates field default
- youtube › createEntry › "should preserve waiting status from base when dependsOn is set" — base spread
- youtube › applySuccess › "should default youtubeVideoId to null when not provided" — `?? null`
- youtube › applySuccess › "should clear previous error message on success" — dup of generic
- buffer › "should be registered in the registry" — restatement
- buffer › createEntry › "should preserve waiting status from base when dependsOn is set" — base spread
- buffer › applySuccess › "should clear previous error message on success" — dup of generic
- buffer › initiate › "should store abort controller in the map" — shared withAbortManagement
- buffer › initiate › "should abort existing controller before starting new one" — shared withAbortManagement (keep youtube copy)

### Consolidate details

#### apps/local/app/features/upload-manager/upload-type-registry-posting.test.ts -> apps/local/app/features/upload-manager/upload-type-registry.test.ts

_Both files were deleted with the browser Upload Manager (sidecar batch 8, #1930): nothing left to consolidate._

- Delete the file. Its 22 tests are two identical blocks (ai-hero, skills-changelog) of: is-registered, supportsDependsOn flag, createEntry null-slug default, waiting preserved, resetEntry nulls slug (x2), applySuccess (x3), initiate abort management (x2) — all either config restatement or shared code (withAbortManagement, base spread, generic error clearing) already covered.
- Move one parametrised test into upload-type-registry.test.ts: `it.each([["ai-hero","aiHeroSlug"],["skills-changelog","skillsChangelogSlug"]])("applySuccess stores the posted %s slug")` — the only behaviour the UI reads (link to the posted article).

## Area F: Animatic, teleprompter, publish, posting, deliverables, beats, thumbnails

| file                                                                               | tests       | runtime | verdict     | conf   | status         | reason                                                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ----------- | ------- | ----------- | ------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/local/app/features/animatic/animatic-chapters.test.ts                         | 12          | 0.0s    | trim        | medium |                | Real grouping/ordering rules (byte order, empty chapter, seek frames); two tests duplicate coverage of others                                                                       |
| apps/local/app/features/animatic/animatic-collapse.test.ts                         | 12          | 0.0s    | trim        | medium |                | Fold-state rules are real; two toggle/icon tests restate a sibling with flipped literals                                                                                            |
| apps/local/app/features/animatic/animatic-empty-state.test.tsx                     | 1           | 0.0s    | delete      | medium |                | Static markup: asserts copy text and an href builder in a stateless component                                                                                                       |
| apps/local/app/features/animatic/animatic-lines.test.ts                            | 5           | 0.0s    | keep        | high   |                | Merge-by-order, byte sort, numbering and comment attachment are real business rules                                                                                                 |
| apps/local/app/features/animatic/animatic-playback-rate.test.ts                    | 6           | 0.0s    | trim        | medium |                | Parser of stored value is worth guarding; one test only asserts the constant table, one duplicates the fallback rule                                                                |
| apps/local/app/features/animatic/animatic-progress.test.ts                         | 9           | 0.0s    | trim        | high   | done (batch 1) | Progress arithmetic is real; CSS-string test mirrors a one-line template                                                                                                            |
| apps/local/app/features/animatic/animatic-revalidation.test.ts                     | 10          | 0.0s    | keep        | medium |                | Each test guards a field the poll signature must include (a dropped field = missed edit); could be parametrised into two test.each tables                                           |
| apps/local/app/features/animatic/animatic-section-clock.test.ts                    | 8           | 0.0s    | keep        | high   |                | Run-time walk order, rate division and clamping are user-visible rules                                                                                                              |
| apps/local/app/features/animatic/animatic-selection.test.ts                        | 17          | 0.0s    | trim        | medium |                | Selection/fold-skipping rules real; three tests are mirror-image duplicates                                                                                                         |
| apps/local/app/features/animatic/animatic-subtitles.test.ts                        | 8           | 0.0s    | keep        | high   |                | Cue splitting/timing and stored-style clamping parser                                                                                                                               |
| apps/local/app/features/animatic/animatic-timeline.test.ts                         | 16          | 0.0s    | keep        | high   |                | Core frame arithmetic; fix commit c100fed9 (adjacentSegmentStartFrame); gap-constant test is a convention guard                                                                     |
| apps/local/app/features/animatic/animatic-transport.test.ts                        | 8           | 0.0s    | trim        | medium |                | Regression guard for fixes 4a170f10/c100fed9 (pause-before-seek); one test duplicates another's end state                                                                           |
| apps/local/app/features/beats/beat-dnd.test.ts                                     | 11          | 0.0s    | trim        | medium |                | Drop-target computation is real logic; two cases duplicate others' outcomes                                                                                                         |
| apps/local/app/features/beats/beat-learning-goals-picker.test.tsx                  | 3           | 0.0s    | trim        | medium |                | Fix provenance (d4a79f6d); checked-state and untitled fallback are behavior, empty-state copy is static markup                                                                      |
| apps/local/app/features/beats/beat-list.test.tsx                                   | 6           | 0.0s    | keep        | medium |                | Fix provenance (94c517ae); covers the showLearningGoals / no-Section / read-only conditional matrix                                                                                 |
| apps/local/app/features/deliverables-calendar/deliverable-grouping-buffer.test.ts  | 5           | 0.0s    | consolidate | medium |                | Same function, same fixture as deliverable-grouping.test.ts; two of five tests restate the default (no-buffer) behaviour                                                            |
| apps/local/app/features/deliverables-calendar/deliverable-grouping.test.ts         | 26          | 0.0s    | trim        | medium |                | Grouping/pastHistory/overdue rules are real; ~7 tests duplicate others or the integration test                                                                                      |
| apps/local/app/features/deliverables-calendar/iso-week.test.ts                     | 1 (15 rows) | 0.0s    | keep        | high   |                | ISO week/year edge cases are exactly where date bugs live                                                                                                                           |
| apps/local/app/features/publish/publish-action.test.ts                             | 8           | 0.0s    | keep        | high   |                | The publish button decision table (hidden/autofill/publish, racing guards)                                                                                                          |
| apps/local/app/features/publish/publish-blockers.test.ts                           | 18          | 0.0s    | trim        | high   | done (batch 1) | Only direct guard on splitAutofillClearable and collectLessonPublishStatuses; three tests assert string concat / lookup table / key builder                                         |
| apps/local/app/features/teleprompter/beats-view.test.tsx                           | 8           | 0.0s    | delete      | medium |                | Static inline-style assertions (font-size, ch width, user-select, overflow-wrap) on a presentational component; link test duplicates linked-text.test.tsx                           |
| apps/local/app/features/teleprompter/linked-text.test.tsx                          | 18          | 0.0s    | keep        | high   |                | URL detection/boundary/label-shortening parser with many real edge cases                                                                                                            |
| apps/local/app/features/teleprompter/script-blocks.test.ts                         | 7           | 0.0s    | keep        | high   |                | Block parser (fences, instructions regions, cues)                                                                                                                                   |
| apps/local/app/features/teleprompter/script-markdown.test.tsx                      | 10          | 0.0s    | trim        | medium |                | Label-shortening and written-label rules are ours; www/email autolinking and prose preservation are remark-gfm behaviour, target=_blank duplicates linked-text                      |
| apps/local/app/features/teleprompter/session-marks.test.tsx                        | 9           | 0.0s    | trim        | medium |                | fitMarks never-fold-unlanded rule is a real guard; order test duplicates it, dot-style test is static CSS                                                                           |
| apps/local/app/features/teleprompter/teleprompter-crawl.test.tsx                   | 7           | 0.0s    | trim        | medium |                | Instructions panel / copy button / list start are worth one check each; CSS and cue-text tests are static markup or duplicate script-blocks                                         |
| apps/local/app/features/teleprompter/teleprompter-session.test.ts                  | 36          | 0.0s    | trim        | medium |                | Session reducer rules (live-edit window, liveness, pinning) are real; a few tab/transcript tests are parallel copies or pass-through                                                |
| apps/local/app/features/thumbnail-editor/thumbnail-state-reducer-capture.test.ts   | 22          | 0.0s    | trim        | high   | done (batch 1) | Effects + pendingAutoSave rules are real; ~10 tests assert initial constants or one-field setters                                                                                   |
| apps/local/app/features/thumbnail-editor/thumbnail-state-reducer-save-edit.test.ts | 20          | 0.0s    | trim        | high   | done (batch 1) | Save/edit/new-thumbnail rules real; ~9 tests are one-field setters or subsets of a sibling                                                                                          |
| apps/local/app/features/video-posting/auto-select-thumbnail.test.ts                | 3           | 0.0s    | delete      | medium |                | Tests a two-line function (`length !== 1 ? null : [0].id`); mirrors the code                                                                                                        |
| apps/local/app/features/video-posting/convert-short-links.test.ts                  | 17          | 0.0s    | trim        | medium |                | URL finder/short-link skip is real; four tests are near-duplicates                                                                                                                  |
| apps/local/app/features/video-posting/lesson-page.test.ts                          | 4           | 0.9s    | delete      | high   | done (batch 1) | Drizzle round-trip of plain `update().set()` on videos.body/description; asserting another table is untouched is tautological. Misplaced (feature dir, tests packages/core service) |
| apps/local/app/features/video-posting/post-page-validation.test.ts                 | 9           | 0.0s    | trim        | medium |                | Single-line title rule is real; three cases restate the same input class                                                                                                            |

### Trim details

#### apps/local/app/features/animatic/animatic-chapters.test.ts

- "keeps each row's timeline index, so no key or highlight moves" — index preservation is covered by the harder under-divider case ("does not shift the indexes of the rows under the divider")
- "does not swallow the rows of the Chapter above it" — covered by "reads as zero and offers nowhere to seek to" plus "shows every Clip Mockup exactly once, wherever the dividers fall"

#### apps/local/app/features/animatic/animatic-collapse.test.ts

- "opens a closed one again" — same toggle rule as "opens with one click" / "closes it, and leaves every other Chapter as it was"
- "reads as 'expand' once all are closed" — already asserted in "is folded away, so the page opens on the dividers alone" (areAllChaptersCollapsed true) and implied by "opens every Chapter once all are closed"

#### apps/local/app/features/animatic/animatic-playback-rate.test.ts

- "offers no rate Remotion refuses" — asserts the contents of the constant table
- "falls back for a value Remotion would refuse" — same rule as "falls back for a rate the control does not offer" (parser accepts only listed rates); fold "0"/"-2" into that test if wanted

#### apps/local/app/features/animatic/animatic-progress.test.ts

- "is a share of whatever it is drawn inside, and zero before a frame is written" — mirrors a one-line template string

#### apps/local/app/features/animatic/animatic-selection.test.ts

- "steps over them on the way up as well" — mirror of "steps over the hidden rows on the way down"
- "selects the first row on screen rather than one behind a fold" — mirror of the "last" variant
- "moves exactly as before when an empty set says nothing is folded" — duplicate of "moves one segment at a time once a selection exists"

#### apps/local/app/features/animatic/animatic-transport.test.ts

- "leaves the Animatic playing" — same end state asserted in "plays on from the new frame when the Animatic was playing" and implied by the call-order test ending in play

#### apps/local/app/features/beats/beat-dnd.test.ts

- "reorders downward within a video (adjacent)" — b→c yields the same "move to end" outcome as "reorders downward within a video (non-adjacent)"
- "moves into an empty video via its container" — same container-append path as "appends when dropped on a video's container"

#### apps/local/app/features/beats/beat-learning-goals-picker.test.tsx

- "says so when the Section has no Learning Goals yet" — static empty-state copy

#### apps/local/app/features/deliverables-calendar/deliverable-grouping.test.ts

- "handles multiple items on the same day sorted by createdAt" — duplicate of "sorts items within a week by date asc, then createdAt asc"
- "returns only current week when all items are archived" — covered by "filters out archived items..." + "returns current week even when no items exist"
- "overdueCount is 0 when no overdue items in week" — asserted in "computes overdueCount per week group" (week21 = 0) and the integration test
- "archived overdue item excluded from both weekGroups and overdueCount" — archived filtering already covered by "filters out archived items from both weekGroups and pastHistory"
- "moves past cancelled items to pastHistory" — covered by "does not count done or cancelled as overdue even when past" and the integration test (d3)
- "keeps future-dated done items inline" — same rule as "keeps future-dated cancelled items inline, not in pastHistory"
- "preserves extra properties on extended types through grouping" — generic pass-through; a type-level concern

#### apps/local/app/features/publish/publish-blockers.test.ts

- "reads as one line of three counts" — string concatenation
- "has a label for every reason it can name" — asserts a lookup table (Record type already forces completeness)
- "keeps two courses' remembered floors apart" — key builder mirror

#### apps/local/app/features/teleprompter/script-markdown.test.tsx

- "linkifies a www address with no protocol" — remark-gfm autolink behaviour
- "linkifies an email address" — remark-gfm autolink behaviour
- "opens a link away from the glass" — duplicate of linked-text "opens links away from the glass"
- "keeps the prose around a link" — markdown renderer behaviour

#### apps/local/app/features/teleprompter/session-marks.test.tsx

- "preserves order when folding" — order already pinned by "never folds away an unlanded mark" (first/last asserts)
- "fills a landed dot and leaves an unlanded one hollow" — static inline-style assertion

#### apps/local/app/features/teleprompter/teleprompter-crawl.test.tsx

- "sets a cue block as written, brackets and all" — duplicate of script-blocks "keeps a cue block's brackets"
- "breaks a word too long for the measure instead of overflowing" — static CSS string
- "lets the script be selected" — static CSS string

#### apps/local/app/features/teleprompter/teleprompter-session.test.ts

- "shows the script when the editor is on the Script tab" — parallel copy of the Beats-tab test
- "shows the Animatic when the editor is on the Animatic tab" — parallel copy of the Beats-tab test
- "adopts what the editor pushed" (in describe "latest transcript") — field pass-through; the drop/clear tests carry the rules

#### apps/local/app/features/thumbnail-editor/thumbnail-state-reducer-capture.test.ts

- "should have correct initial state" — restates initial constants
- "open-camera: should set cameraOpen to true" — one-field setter
- "close-camera: should set cameraOpen to false" — one-field setter
- "background-removal-failed: should set error and clear removingBackground" — setter; fully covered by "background-removal-failed then retry: should recover and emit new effect"
- "diagram-pasted: should set diagramImage and diagramPosition" — duplicate of "diagram-pasted: works without capturedPhoto (diagram-first workflow)"
- "diagram-removed: should clear diagramImage" — one-field setter
- "diagram-position-changed: should update diagramPosition" — one-field setter
- "cutout-removed: should clear cutoutImage" — one-field setter
- "cutout-position-changed: should update cutoutPosition" — one-field setter
- "retry-background-removal: should clear error, set removingBackground, and emit effect" — subsumed by "background-removal-failed then retry: should recover and emit new effect"
  (Optional: parametrise the four "...should set pendingAutoSave when editingThumbnailId is set" tests into one test.each.)

#### apps/local/app/features/thumbnail-editor/thumbnail-state-reducer-save-edit.test.ts

- "save-succeeded: should preserve previewDataUrl" — one field of a reducer that doesn't touch it
- "save-failed: should set saving to false" — subset of "save-failed: should preserve editor state"
- "delete-failed: should clear deleting" — one-field setter
- "edit-failed: should clear loadingEdit" — one-field setter
- "edit-loaded: should handle thumbnail with no diagram or cutout" — same copy-through as "edit-loaded: should populate editor with loaded data"
- "new-thumbnail-clicked: should clear pendingAutoSave" — fold one assert into "new-thumbnail-clicked: should clear all editor state"
- "new-thumbnail-clicked: should clear previewDataUrl" — fold one assert into "new-thumbnail-clicked: should clear all editor state"
- "preview-updated: should set previewDataUrl" — one-field setter
- "preview-updated: should handle null (cleared preview)" — one-field setter

#### apps/local/app/features/video-posting/convert-short-links.test.ts

- "returns multiple distinct URLs" — covered by "handles mixed short and long links" + dedupe test
- "returns true for www variant" — www handling already covered in findConvertibleAiHeroUrls tests
- "replaces a single URL" — subsumed by "replaces all occurrences of a URL"
- "returns text unchanged when replacements map is empty" — trivial no-op

#### apps/local/app/features/video-posting/post-page-validation.test.ts

- "returns null for a single line with trailing newline" — same class as "returns null for a single line surrounded by blank lines"
- "returns null for a single non-empty line among blank lines" — duplicate of "returns null for a single line surrounded by blank lines"
- "returns error for multiple candidate lines separated by blank lines" — same rule as "returns error for two non-empty lines"

### Consolidate details

#### apps/local/app/features/deliverables-calendar/deliverable-grouping-buffer.test.ts

- Target: apps/local/app/features/deliverables-calendar/deliverable-grouping.test.ts (new `describe("overdueCutoffStr")` block reusing that file's `today`/`makeDeliverable`, which are copy-pasted here).
- Move: "buffer=1 week marks planned items within the next 7 days as overdue" (the cutoff boundary rule), "buffer does not count done or cancelled items as overdue even within buffer", "buffer does not affect pastHistory bucketing — only overdueCount changes".
- Drop: "buffer=0 reproduces default overdue behaviour (date < today)" and "buffer=0 with explicit cutoff=todayStr exactly matches no-option behaviour" — both restate the default overdue rule already covered by "computes overdueCount per week group".
