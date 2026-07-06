# Segment → Beat: the "segment" homonym boundary

Research asset for [Wayfinder map #1137](https://github.com/mattpocock/course-video-manager/issues/1137),
resolving [#1139 — Map the Segment homonym boundary](https://github.com/mattpocock/course-video-manager/issues/1139).

## TL;DR

The **Segment → Beat** rename touches ~2,232 `segment` occurrences across ~120 files.
**All but ~28 of them are the domain Segment** (the film-time video planning unit) and **rename to Beat**.
The non-renaming occurrences fall into **three homonym classes**, confined to **5 files**:

| Homonym class                                            | Files                                                                          | Occ   | Why it stays "segment"                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------- |
| **Transcription segment** (Whisper start/end/text spans) | `app/services/video-processing-service.ts`, `app/routes/clips.transcribe.ts`   | 9 + 2 | External OpenAI Whisper API contract + derived transcript spans; nothing to do with the planning unit |
| **Path segment** (`"a/b/c".split("/")`)                  | `app/services/vfs/vfs-path.ts`, `app/services/vfs/vfs-tree.ts` (2 of 14 lines) | 6 + 2 | Generic URL/VFS path-part parsing                                                                     |
| **Speech/silence segment** (a stretch of audio)          | `app/services/silence-detection.test.ts` (comment)                             | 1     | Audio-time span, not a domain entity                                                                  |

**Everything not listed in the "Exclude" section below is a domain Segment and renames to Beat.**
Rename-by-default is safe; only these 5 files need care.

> ⚠️ **Charting correction:** `app/features/course-view/section-transcript.ts` (and its
> `section-transcript-segments.test.ts`) were flagged as candidate homonym zones during charting
> **because of the filename**. They are **not** homonyms — they render `video.segments`
> (domain Segments, with `.kind`/`.title`/`.description`) into the transcript export XML/markdown.
> **They rename.** See the note under "Include" about the resulting output-format change.

---

## Exclude — these "segment" occurrences must STAY "segment"

### 1. Transcription segments (Whisper API result spans)

A "segment" here is a `{ start, end, text }` span returned by OpenAI's Whisper transcription API —
a chunk of transcribed audio. It is unrelated to the planning unit and partly a **hard external contract**.

**`app/services/video-processing-service.ts`** — all 9 occurrences are transcription segments:

- L21/L31 — `transcribeClipsSchema`: `segments: Schema.Array({ start, end, text })`
- L182 — comment "Extract audio from a video clip segment using ffmpeg" (audio-time, homonym)
- **L250 — `timestamp_granularities: ["segment", "word"]`** — **OpenAI Whisper API literal. Must not change** (external contract).
- L262–265 — `response.segments.map((segment) => ({ start, end, text }))`
- L287 — comment "Extract audio segment from video" (audio-time, homonym)
- L305 — `segments: transcription.segments` (schema field passthrough)

**`app/routes/clips.transcribe.ts`** — both occurrences are transcription segments:

- L9–17 — `transcribeClipsSchema.segments: Schema.Array({ start, end, text })`
- L39–40 — `transcribedClip.segments.map((segment) => segment.text).join(" ")` (concatenates the spans into `clip.text`)

> There is **no DB column** for transcription segments — they are transient (Whisper → concatenated into `clip.text`), so the DB migration is unaffected by this class.

### 2. Path segments (`split("/")`)

A "segment" here is a slash-delimited part of a VFS/URL path — generic string parsing.

**`app/services/vfs/vfs-path.ts`** — all 6 occurrences are path segments:

- L13 `let segments: string[]`, L20/L24/L26/L28 (build from `split("/")`), L32 `for (const seg of segments)`.

**`app/services/vfs/vfs-tree.ts`** — **2 of 14** occurrences are path segments (the rest are domain — see Include):

- L235 `const segments = absolutePath.split("/").filter(Boolean)` — path segment (**homonym, stays**)
- L238 `for (const seg of segments)` — iterates the path parts (**homonym, stays**)
- L8/L20/L90/L172–189 — `SegmentLeaf`, `video.segments`, the `"segments"` VFS dir for domain Segments (**domain, renames** — see Include)

> ⚠️ `vfs-tree.ts` is the one genuinely **mixed** file: a blind rename would corrupt the path-parsing
> locals at L235/L238. Rename this file **by hand / by reviewed hunk**, not by global replace.

### 3. Speech / silence segments

A "segment" here is a stretch of audio between silences.

**`app/services/silence-detection.test.ts`** — 1 occurrence:

- L23 — comment: "Speaking segment: silence ends at 2.0s, next silence starts at 5.0s → clip 2.0–5.0".

> `app/services/silence-detection.ts` (the implementation) contains **zero** `segment` occurrences —
> only the test comment uses the word. Nothing in the silence subsystem renames.

---

## Include — everything else renames to Beat

Every other `segment` occurrence in the codebase refers to the **domain Segment** and renames to **Beat**.
The high-signal anchors (rename-by-default still applies to files not listed):

- **DB / schema:** `app/db/schema.ts` — `segments` table (`createTable("segment", …)`), `segmentsRelations`, `videos.segments` relation. Drives the SQL migration (`ALTER TABLE … RENAME`, per the map's precedent) and Drizzle push.
- **Services:** `app/services/db-segment-operations.server.ts`, `course-editor-service*.ts`, `db-video-operations.copy.server.ts` (`copySegments`), `db-search-operations.server.ts` (`kind: "segment"` search-node type — domain), `db-course-duplicate.server.ts`, `db-version-operations.server.ts` (`copyVersionStructure` Segment-copy step), `course-repo-parser.ts`.
- **VFS / agent-diff:** `vfs-leaves.ts` (`SegmentLeaf`, `generateSortedSegments`), `vfs-tree.ts` (domain parts — see caveat above), `derive-diff-types.ts` (`entityType: "segment"`, the `"segments"` manifest dir), `agent-diff-executor*.ts`. **Note:** the on-disk/agent VFS path string `…/videos/<v>/segments/_members.json` is the **domain** Segment directory and renames (e.g. → `…/beats/_members.json`) — do not confuse with the path-_parsing_ homonym above.
- **CLI:** `app/cli/commands/segment.ts` + `segment.help.ts` (the `segment` noun), `search.ts`, `cli-integration.test.ts`, `cli-pitch-segment-writes.test.ts`.
- **UI / features:** all of `app/features/segments/*`, `app/features/video-editor/segment-tab*`, `app/features/course-view/*` (incl. `section-transcript.ts` / `lesson-segment-tree.tsx` / `optimistic-applier*`), `app/components/copy-video-modal.tsx`, `copy-transcript-modal.tsx` (`includeSegments`), route files.
- **Docs:** `CONTEXT.md` (the **Segment** glossary entry), `docs/adr/0015-video-level-segment-planning.md`, `docs/adr/0016-videos-on-ghost-lessons.md`.

### Output-format change to flag (not a homonym, but a consequence)

`section-transcript.ts` emits domain Segments into the **copy-transcript** export:
`renderSegmentsXml` writes `<segment kind="…" title="…">…</segment>` tags, `renderSegmentsMarkdown`
writes `- [kind] title`, and the JSON export writes a `segments: [...]` array — all gated behind the
`includeSegments` option (surfaced in `copy-transcript-modal.tsx`). Renaming to Beat **changes the
emitted XML tag to `<beat>`, the JSON key to `beats`, and the UI toggle to "include Beats"**. This is
in scope and correct, but it is a user-visible/agent-visible output change, not a pure internal rename —
worth a callout in the execution ticket so the transcript-export tests are updated deliberately.

---

## Mechanical guidance for the Segment → Beat execution

1. **Global rename is safe for ~115 of ~120 files.** The domain Segment dominates.
2. **Hand-review these 5 files** (they contain non-renaming `segment`):
   - `app/services/video-processing-service.ts` — leave **all** `segment` as-is.
   - `app/routes/clips.transcribe.ts` — leave **both** `segment` as-is.
   - `app/services/vfs/vfs-path.ts` — leave **all** `segment` as-is.
   - `app/services/vfs/vfs-tree.ts` — **mixed**: rename domain (`SegmentLeaf`, `video.segments`, the `"segments"` dir); keep the L235/L238 path-split locals.
   - `app/services/silence-detection.test.ts` — leave the L23 comment as-is.
3. **Never touch** the Whisper literal `timestamp_granularities: ["segment", "word"]` — it is an external API string, not a domain reference.
4. The **transcription-segment** class has **no DB footprint**, so the SQL migration only needs to worry about the domain `segments` table.
