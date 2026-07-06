# Spec: Rename Segment → Beat (and Beat → Pause)

**Status:** Ready for implementation.
**Source:** Wayfinder map [#1137](https://github.com/mattpocock/course-video-manager/issues/1137). This document consolidates the locked decisions from that map's tickets into a single implementation-ready specification. It is a _spec_, not an implementation log — it says what to change and why, not how to sequence the edits within a session.

---

## 1. Why

Two unrelated concepts collided on the word **beat**, and one on **pause**:

- **`clip.beat_type`** — a clip-level _held pause_ (`none` / `long`).
- **Segment** — the film-time video _planning unit_ (a first-class entity, five kinds).
- **session "Pause Length"** — the silence-threshold setting (`short` / `long`) that controls how long a _silence_ must run before a clip is cut.

"Beat" wanted to be freed for the planning unit (a natural narrative-unit name), but it was occupied by the clip held-pause field. "Pause" was the natural name for that clip field, but it read as related to session "Pause Length" — which was itself a slight misnomer (it measures _silence_, not a held pause).

The fix is a **cascade of three renames**, each freeing the word the next one needs:

> **Silence Length rename → clip Beat → Pause → Segment → Beat**

The order is load-bearing. Out of order, a word means two things at once mid-flight.

| #   | Rename                                    | Frees              | DB migration?           |
| --- | ----------------------------------------- | ------------------ | ----------------------- |
| 1   | session **Pause Length → Silence Length** | the word **Pause** | No — code-only          |
| 2   | clip **`beat_type` → Pause**              | the word **Beat**  | Yes — one column rename |
| 3   | **Segment → Beat**                        | —                  | Yes — one table rename  |

---

## 2. Rename #1 — session Pause Length → Silence Length

**Code-only.** This is the `PauseLength` type + `PAUSE_LENGTH_*` constants in `app/silence-detection-constants.ts`, threaded as a runtime/event param — **never persisted**, so no migration.

| was                                                                      | becomes                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| "Pause Length" (concept / glossary term)                                 | **Silence Length**                                             |
| `type PauseLength`                                                       | `SilenceLength`                                                |
| `pauseLength` (fields / params / event inputs / schemas / reducer tests) | `silenceLength`                                                |
| `PAUSE_LENGTH_SHORT_SECONDS` / `PAUSE_LENGTH_LONG_SECONDS`               | `SILENCE_LENGTH_SHORT_SECONDS` / `SILENCE_LENGTH_LONG_SECONDS` |
| `DEFAULT_PAUSE_LENGTH`                                                   | `DEFAULT_SILENCE_LENGTH`                                       |
| `pauseLengthToSeconds`                                                   | `silenceLengthToSeconds`                                       |
| `usePauseLength` hook (file `use-pause-length.ts`)                       | `useSilenceLength` (`use-silence-length.ts`)                   |
| `PauseLengthToggle` (file `pause-length-toggle.tsx`)                     | `SilenceLengthToggle` (`silence-length-toggle.tsx`)            |
| localStorage key `video-editor:pauseLength`                              | `video-editor:silenceLength`                                   |
| UI label                                                                 | **"Silence length:"**                                          |
| values `short` / `long`                                                  | **unchanged**                                                  |

**Status: already executed** — see [#1144](https://github.com/mattpocock/course-video-manager/issues/1144) (25 files, typecheck + 271 tests pass; draft PR #1146). The CONTEXT.md glossary half is merged (PR #1145). Listed here for completeness so the spec is whole.

---

## 3. Rename #2 — clip beatType → Pause

The session collision is now resolved (rename #1), so the clip field takes **Pause** cleanly and **keeps** its `long` value.

| was                                                                             | becomes                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `clip.beat_type` (DB column, `varchar` default `"none"`)                        | `clip.pause_type`                                                          |
| `type BeatType`                                                                 | `PauseType`                                                                |
| `beatType` (fields / params)                                                    | `pauseType`                                                                |
| values `none` / `long`                                                          | **unchanged** — `none` = ordinary clip, `long` = held pause                |
| `LONG_BEAT_DURATION` (~0.18s constant)                                          | `LONG_PAUSE_DURATION`                                                      |
| actions `update-beat`, `toggle-beat-at-insertion-point`, `toggle-beat-for-clip` | `update-pause`, `toggle-pause-at-insertion-point`, `toggle-pause-for-clip` |
| UI `BeatIndicator` (the "…")                                                    | `PauseIndicator`                                                           |
| `cvm clip` help output field `beatType`                                         | `pauseType`                                                                |

**Column is `pause_type`, not `pause_length`** — "length" is now Silence Length's word; re-pairing "pause" + "length" would reintroduce the ambiguity being removed. The enum shape is kept (may gain rungs later); values `none` / `long` are unchanged, so **no value-data migration** — only the column rename.

**Migration:** follow the precedent — `scripts/rename-clip-beat-type-to-pause.sql` with `ALTER TABLE "course-video-manager_clip" RENAME COLUMN "beat_type" TO "pause_type"` in a transaction → update `app/db/schema.ts` → `drizzle-kit push` to sync constraint/index names → fix all code.

**Scale:** ~45 occ / ~24 files, localized to the video-editor / clip subsystem. Single session. **Leave session-level Silence Length untouched.**

---

## 4. Rename #3 — Segment → Beat

Rename the film-time planning unit **Segment → Beat**, adopting "Beat" in the **screenwriting sense** (a narrative unit of story/action). This _deliberately reverses_ the glossary's prior `_Avoid_: Beat` rejection, whose two grounds are now both cleared: (a) the `beatType` / pause collision — resolved by rename #2; (b) "a narrative-unit synonym rejected upstream" — reversed on purpose, because the narrative-unit reading is exactly what fits "a single film-time planning unit classified by its job."

Pure 1:1 `segment` → `beat`, **no semantic change**:

| Layer                | Current                                                           | → Beat                                                      |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| DB table             | `course-video-manager_segment`                                    | `course-video-manager_beat`                                 |
| Drizzle relation     | `segments`                                                        | `beats`                                                     |
| CLI noun + verb help | `cvm segment`                                                     | `cvm beat`                                                  |
| Feature dir          | `app/features/segments/`                                          | `app/features/beats/`                                       |
| Kind tuple / default | `SEGMENT_KINDS` / `DEFAULT_SEGMENT_KIND`                          | `BEAT_KINDS` / `DEFAULT_BEAT_KIND`                          |
| Kind type + maps     | `SegmentKind`, `SEGMENT_KIND_LABELS` / `_ICONS` / `_DESCRIPTIONS` | `BeatKind`, `BEAT_KIND_LABELS` / `_ICONS` / `_DESCRIPTIONS` |
| Planning note        | **Segment Description**                                           | **Beat Description**                                        |
| Five kinds           | Definition / Walkthrough / Playthrough / Quest / Reaction         | **unchanged**                                               |

- **Kind enum string values stay as-is** (`"definition"`, `"walkthrough"`, `"playthrough"`, `"quest"`, `"reaction"`), stored in `beat.kind`. Only the surrounding `SEGMENT_` prefix becomes `BEAT_`. **No `kind`-value data migration** — only the table/column rename.
- **"Beat Description"** chosen over "Beat Note" for continuity with the existing term.
- Optional `cvm segment` **back-compat alias**: decide during the CLI rename; not required.

**Scale:** ~2,232 occ / ~120 files — every layer. Multi-session.

### 4a. The homonym boundary (critical — do not blind-rename)

Of the ~2,232 `segment` occurrences, **all but ~28 are the domain Segment and rename to Beat.** The non-renaming **"segment" homonym** is confined to **5 files** — leave `segment` untouched in these:

1. **Transcription segment** (Whisper `{start,end,text}` spans) — `app/services/video-processing-service.ts` (9), `app/routes/clips.transcribe.ts` (2). Includes the **hard external-API literal** `timestamp_granularities: ["segment","word"]` — never touch. No DB footprint.
2. **Path segment** (`"a/b/c".split("/")`) — `app/services/vfs/vfs-path.ts` (all 6), plus **2 of 14** lines in `app/services/vfs/vfs-tree.ts` (L235 / L238 only).
3. **Speech/silence segment** — one comment in `app/services/silence-detection.test.ts` (L23). (`silence-detection.ts` itself has zero occurrences.)

**`vfs-tree.ts` is the one genuinely mixed file** — rename the domain parts, keep the L235/L238 path-split locals. The other ~115 files are safe to rename globally.

**Two charting hunches were corrected — do NOT treat these as homonyms:**

- **`app/features/course-view/section-transcript.ts` renames.** It renders domain `video.segments` (`.kind`/`.title`/`.description`) into the copy-transcript export. Consequence: the emitted `<segment>` XML tag → `<beat>`, the JSON key `segments` → `beats`, and the `includeSegments` UI toggle → "include Beats". This is a **user/agent-visible output-format change** — update the transcript-export tests deliberately.
- **`db-search-operations.server.ts` / `derive-diff*` are domain, not homonyms** — their `kind: "segment"` / `entityType: "segment"` / the `…/segments/_members.json` VFS dir all refer to the domain Segment and rename. Only path-_parsing_ code (not path _dir names_) is the homonym.

Full detail: `docs/segment-to-beat-homonym-boundary.md` (from [#1139](https://github.com/mattpocock/course-video-manager/issues/1139)).

---

## 5. Glossary (CONTEXT.md)

Rename #1's glossary edits are **already merged** (PR #1145): "Pause Length" entry → **Silence Length**, plus a new one-line clip **Pause** entry beside it, each cross-referencing "distinct from" the other.

Rename #3's glossary edits are applied **as part of its docs layer** (verbatim below).

**Beat** (replaces the **Segment** entry):

> A single film-time planning unit of a **Video**, classified by its **job** — what it does for the viewer. We lean into the screenwriting sense of a _beat_: a narrative unit of story/action. A Video's plan is an ordered sequence of Beats, authored _before_ the video is recorded; planning a video means choosing "one of these, then one of these". A first-class entity that belongs to a **Video** (not the **Lesson** or **Pitch**), so each Video carries its own plan and duplicating a Video copies its Beats. A Beat can be **moved between Videos** by dragging it from one video's plan into another's (reassigning its parent), but Videos themselves are not reordered — they sort alphabetically by name. Deliberately **distinct from a Chapter**: a Chapter is a recorded-timeline grouping that maps 1:1 to YouTube and groups **Clips**; a Beat is the _intended_ structure and need not correspond to any Chapter or Clip. The two are separate views — "what I planned to shoot" vs "what I shot". Five kinds, drawn from the Mise en Place glossary: **Definition**, **Walkthrough**, **Playthrough**, **Quest**, **Reaction**.
> _Avoid_: Chapter (the recorded YouTube grouping), Segment (now means only the transcript/silence homonym — a timestamped span of source footage), Section (course Section), Block, Unit

**Beat Description** (replaces **Segment Description**):

> A free-text planning note on a **Beat** — "what I'm actually going to do or say here" — distinct from its short **title**. Plain text, edited inline (auto-growing textarea). A purely in-app authoring aid: like the Beat itself, it is never published (Publish skips it). Surfaced and editable on the **Section Workbench** and on the editor's **Beats tab** (the current video's plan, read while recording); deliberately **hidden on the course view**, which is already information-dense.

Reconcile the exact `_Avoid_` cross-references (and the pre-existing "source footage" entry whose `_Avoid_` lists "Segment") against the homonym boundary (§4a) when applying.

---

## 6. New ADR

Author a short ADR — **"Adopt Beat as the name for the film-time planning unit"** — as part of rename #3's docs layer. It records the narrative-unit rationale + the cleared collision, because this reverses an explicit glossary rejection and deserves an audit trail. It **supersedes the _naming_ in ADR-0015** (0015 keeps its structural decision — video-level, separate from Chapters — and gets a pointer). **Do not** rewrite 0015's reasoning in place.

---

## 7. Skills tail (personal-wiki repo)

After the `cvm beat` CLI surface is final, update the `planning-courses` and `cvm` skills in `~/repos/matt/personal-wiki` (`.claude/skills/planning-courses/`, `.claude/skills/cvm/`) to the new vocabulary. This is downstream of implementation, in a different repo.

---

## 8. Migration pattern (precedent)

For the two renames with a DB footprint (#2, #3): `scripts/rename-*.sql` with `ALTER TABLE … RENAME` in a transaction (in-place, no data loss) → update the Drizzle schema in `app/db/schema.ts` → `drizzle-kit push` to sync constraint/index names → fix all code. See `scripts/rename-clip-section-to-chapter.sql`, `scripts/rename-repo-to-course.sql`.
