# Course Video Manager

A tool for authoring courses as structured collections of sections, lessons, and videos — held entirely in the database and published as immutable snapshots (`.mp4` files plus a `course.json`).

## Language

### Course structure

**Course**:
The primary domain entity: a structured collection of versions, sections, lessons, and videos, held entirely in the database. Not backed by any on-disk repository — the former git-repo backing was retired (ADR 0018).
_Avoid_: Repo, Project

**Section**:
A grouping of lessons within a course version, ordered by fractional index. Identity is carried by its `title` (uniqueness enforced per-parent by `order`); its display path is derived from title, not stored.
_Avoid_: Module, Unit

**Lesson**:
A single learning unit within a section. A pure database record — no on-disk folder. Identity is carried by its `title` (uniqueness per-parent by `order`).
_Avoid_: Exercise, Tutorial, Step

### Course versions

**CourseVersion**:
A snapshot of a course's section/lesson/video structure. Its lifecycle state is recorded explicitly (never inferred from position or naming): Draft Version → Pending Version → Published Version.
_Avoid_: Version (too vague), Revision

**Draft Version**:
The single mutable CourseVersion being edited — the only state accepting section/lesson/video/clip writes. Exactly one per course; no name or description.
_Avoid_: Current version, Working version

**Pending Version**:
A Submitted CourseVersion whose Dropbox commit receipt has not yet landed. Immutable, named, short-lived: either Promoted (receipt landed) or Discarded (commit failed). At most one per course; one at rest means a crash between receipt and Promote — the publish page reconciles it on load: Promote if the receipt committed, else one-click Discard.
_Avoid_: Frozen version (ambiguous with Published), In-flight version

**Published Version**:
An immutable CourseVersion with a name and description, created by Promoting a Pending Version; cannot be deleted.
_Avoid_: Released version, Committed version

**Submit**:
The Draft → Pending transition: stamps the publish name/description, marks the Draft Pending, and clones a fresh Draft. Refused while a Pending Version exists. In-flight writes serialize with it: each lands before the clone or is refused terminally.
_Avoid_: Freeze (only half the story), Snapshot

**Promote**:
The Pending → Published transition, recorded once the Dropbox commit receipt (the atomic `course.json` rename) has landed.
_Avoid_: Finalize, Confirm

**Discard**:
Deletes a Pending Version whose commit did not land — never a Draft or Published one. Loses nothing: the content lives on in the cloned Draft. A caught commit failure auto-Discards (sync failures get one in-flight retry first; missing assets Discard immediately).
_Avoid_: Rollback, Delete version

**Publish**:
The release flow: validate, Submit, then export and the Dropbox commit interleaved, then export garbage collection, then Promote. Submit comes first because it is a pure database transaction and it is what makes everything after it sound — a Draft still accepts Clip, Video and Section writes, and a Video's title is its path inside the **Bundle**. Any **Unexported Video** is then rendered by the Publish itself, and each one starts uploading the moment its own export finishes rather than waiting for the rest: an export pool (GPU-bound, six-way concurrent) and an upload pool (network-bound, its own smaller limit) run at the same time, connected by a per-Video handoff. Structure is derived from the database (never parsed from disk); the Dropbox output is exclusively `.mp4` files plus one `course.json` and its companion `course.schema.json` (referenced via `$schema`) — no authoring sidecars, no `changelog.md`. Every shipping **Video** must be complete — exportable **Clips** (hence an `.mp4` and an **Export Hash**), a `body`, and a `description` — so no `course.json` field is ever null; an incomplete Video fails the Publish (ADR 0019). A failed export or a caught commit failure auto-Discards the Pending Version.
_Avoid_: Commit (that is one phase of it), Deploy, Push

**Bundle**:
What a **Publish** actually produces: one self-contained, immutable directory under `{course}/versions/{versionFingerprint}-{assetFingerprint}/` holding every shipping Video's `.mp4`, a `manifest.json`, and a `course.schema.json`. The course root's `course.json` is the sole mutable object — the commit receipt naming the Bundle now current, written last and atomically. The address is derived from the manifest schema, the course identifiers, the section tree, the to-do setting, and each Video's **Export Hash** — all database state, so the destination is knowable before any encoding begins. Same inputs, same path: a Bundle is never mutated, and a Video found at an existing address with mismatched bytes is a hard failure rather than an overwrite. A Publish interrupted partway leaves a resumable Bundle — the next attempt uploads only what is absent. The downstream consumer expires a release by deleting the Bundle directory wholesale; this system has no delete role (ADR 0023).
_Avoid_: Asset folder, Release folder, Blob pool (deliberately rejected — see ADR 0023)

**Publish Readiness**:
The answer to "what stands between this Course and shipping?", computed for a **CourseVersion** as four lists of outstanding work: **Unexported Videos**, course-view lints (the lesson-level role warnings plus every **Video Warning**, carried as `courseViewLints`), invalid Lesson role combos, and incomplete **Videos**. Computed against the effective output, so it differs by the to-do toggle. Only three of the four stop a release: lints refuse the **Publish** outright, and invalid combos / incomplete Videos fail the later `course.json` build — whereas an **Unexported Video** is rendered by the Publish itself as its export stage and blocks nothing. A single "can this ship?" reading must therefore exclude the unexported set. One walk backs the publish gate, the publish page's pre-publish warnings, and the read-only `cvm course readiness` verb, so they can never disagree. Distinct from authoring progress, which is toggle-independent and counts work no Publish would ship.
_Avoid_: Publish status, Readiness check, Blockers (only three of the four lists block)

**Export Version Key**:
A hardcoded constant in the codebase (`EXPORT_VERSION`) that, when bumped, invalidates all video export hashes and forces re-export.
_Avoid_: Version number, Build version

### Authoring lifecycle

**Lesson Authoring Status**:
A per-version marker on a **Lesson**: `todo` (default for new lessons) or `done` (set via the To-Do pill). Stored as `authoringStatus` and copied forward at Publish, so a Published Version's lessons keep their status at publish time. Every lesson has one (no ghost/real distinction). Distinct from **Pitch State**. Surfaced via the To-Do pill and the **Marked Ready** / **Marked TODO** changelog buckets.
_Avoid_: TODO flag, Completion

**Marked Ready** / **Marked TODO**:
The changelog buckets for **Lesson Authoring Status** transitions across **Published Versions** — `todo → done` and `done → todo` respectively. First-class per-section sections in the in-app changelog preview shown on the publish screen (the changelog is no longer written to disk).
_Avoid_: Completed, Reopened

### Video and clips

**Video**:
A container of clips and chapters that represents a single producible video output.
_Avoid_: Recording

**Standalone Video**:
A video with no lesson association (`lessonId = NULL`), used for reference or temporary content. A SEPARATE axis from **Video Format**: a Standalone video may be either **Landscape** or **Short**, and every **Short** is Standalone. Never use "Standalone" to mean a format.
_Avoid_: Orphan video, Unlinked video

**Video Format**:
An axis on every **Video** (the `video.format` column). One of two values: **Landscape** or **Short**. Defaults to Landscape.

**Landscape**:
A **Video** with `format: "landscape"`: a horizontal, long-form video. The default format. Shown in the app under `/videos`.
_Avoid_: Standard (the old value name)

**Short**:
A **Video** with `format: "short"`: a vertical, short-form video (the kind posted to YouTube Shorts / TikTok / etc.). Shown in the app under `/shorts`. "Short" is canonical everywhere.
_Avoid_: TikTok (reserved for the actual TikTok platform — the OBS recording profile and Buffer posting destinations — and NOT the canonical name for a Short)

**Clip**:
A timestamped segment of source footage within a video, defined by start/end times and a source filename.
_Avoid_: Segment, Cut, Take

**Effect Clip**:
A special clip for non-speech content (white noise, transitions) manually inserted into the timeline.
_Avoid_: Filler, Spacer

**Chapter**:
A named marker/divider within a video's timeline that visually groups related clips. Maps 1:1 to YouTube chapters.
_Avoid_: Clip group, Divider, Marker, Section (ambiguous with course Section)

**Video Post**:
A record of a **Video** posted to an external platform. Child of Video (cascade-deleted). Tracks platform, remote id/URL, `postedAt`.

**Optimistic Clip**:
A clip added to the frontend state during recording before it is persisted to the database.
_Avoid_: Pending clip, Temporary clip

**Clip Web Link**:
A web page on screen (focused Chrome window, `http(s)` page) while a **Clip** was recorded. One-to-many child of a Clip, captured live during the **Optimistic Clip** lifecycle by the link-capture Chrome extension (`chrome-extension/`) over the Stream Deck WebSocket hub; deduped per URL per Clip. Shown as chips under the Clip and annotated in the **Transcript** (`«on screen: …»`, first appearance only) so the writer agent knows which page accompanied each moment. Distinct from the global **Link** list: a Clip Web Link is positional and per-clip.
_Avoid_: Link (reserved for the global reference-URL list), Clip URL, On-screen link (informal, ok in prose)

**Transcript**:
The ordered text projection of a **Video** — its **Clips** and **Chapters** interleaved in timeline order. The unit of comparison for changelog diffs. Changes to either Clips or Chapters are first-class changes to the Transcript: a Chapter rename, insertion, deletion, or reorder is a Transcript change in the same sense that editing a Clip's text is. Rendered with each Chapter as a `## <name>` header between paragraphs of clip text.
_Avoid_: Clip text (only covers Clips), Joined clips, Caption (reserved for the per-clip transcription product)

**Video File**:
A plain file on disk attached to a **Video**, under `{VIDEO_FILES_DIR}/{lineageId}/` and addressed relative to it. Not a database row — the directory listing **is** the state; deleting is a real unlink (no `archived`, no restore). Belongs to the Video, never the Lesson; lesson-bound and **Standalone Videos** behave identically. Purpose: **writer context** — the Article Writer reads a Video's **Transcript**, **Script**, **Beats**, and text Video Files. Those sources are ranked by the fidelity ladder (see **Script**): the Transcript alone sets what the article may claim, and text Video Files are supporting material showing what was on screen (code samples, notes, session logs) that the writer draws detail and evidence from, never a source of claims in their own right. Extensions `ts/tsx/js/jsx/json/md/mdx/txt/csv` are ticked by default in the writer's picker; others start unticked; images pass as images. Subdirectories allowed; dotfiles and `node_modules` ignored. Managed from the editor UI or `cvm file`.
_Avoid_: Attachment, Asset (reserved for exported/published artifacts), Standalone file / Lesson file (the old UI-era split, now one concept)

### Video planning

**Beat**:
A single film-time planning unit of a **Video**, classified by its **job** for the viewer (the screenwriting sense of _beat_). A Video's plan is an ordered sequence of Beats authored _before_ recording. First-class entity belonging to the **Video** (not Lesson or Pitch): duplicating a Video copies its Beats, and a Beat can be dragged between Videos (Videos themselves sort alphabetically, never reordered). Deliberately **distinct from a Chapter** (the recorded-timeline grouping of **Clips**): a Beat is the _intended_ structure — "what I planned to shoot" vs "what I shot". Five kinds from the Mise en Place glossary: **Definition**, **Walkthrough**, **Playthrough**, **Quest**, **Reaction**.
_Avoid_: Chapter (the recorded YouTube grouping), Segment (now only the transcript/silence homonym), Section (course Section), Block, Unit

**Beat Description**:
A free-text planning note on a **Beat** — "what I'm actually going to do or say here" — distinct from its short **title**. Plain text, edited inline (auto-growing textarea). A purely in-app authoring aid: like the Beat itself, it is never published (Publish skips it). Surfaced and editable on the **Section Workbench** and on the editor's **Beats tab** (the current video's plan, read while recording); deliberately **hidden on the course view**, which is already information-dense.
_Avoid_: Notes, Summary, Body, Caption

**Script**:
The high-fidelity, screenplay-style plan of a **Video** — one flowing document per Video (verbatim prose for definition/framing beats, `[bracketed cues]` for improvised playthroughs) read off the teleprompter while filming. A single `script` field on the Video, one rung above **Beats** on the fidelity ladder (Beats sketch the moves; the Script writes them out; the recorded **Transcript** is the top rung and supersedes both once filmed). Internal like the **Beat Description**: copied into version snapshots and into a duplicated Video, but never published — omitted from the shipped `course.json` (only `body` and `description` are the Video's shipping text). Authored via the CLI (`cvm video script` / `update --script`) or in the UI: an always-available **Script tab** in the editor side slot (full Article-Writer field) and an "Edit Script" action on every video action menu. Distinct from the **Body** (the published lesson article) and the **Beat Description** (a per-beat note).
_Avoid_: Body (the published article), Beat Description (the per-beat note), Transcript (what was actually said), Caption

**Section Workbench**:
A drill-down authoring surface for one **Section** (`/courses/:courseId/sections/:sectionId`), reached from the course view via a Section header (top) or Lesson title (deep link). An expanded reskin of the compact course view: shows each Lesson's **Videos** and **Beats** with **Beat Descriptions** inline-editable. Its added value is that beat/description layer; structural editing is inherited from the reused course-view components. Sibling sections are not shown — go back through the course view.
_Avoid_: Section page, Lesson page (the workbench is section-altitude; there is no lesson-altitude page), Section editor

### Video warnings

**Video Warning**:
A derived, non-blocking authoring problem surfaced on a **Video** in the UI. Computed live from the video's clips and chapters — never stored. Each warning has a stable kind (e.g. `missingChapters`). Generalizes the existing per-clip "danger" signal (Levenshtein text similarity) to the video level so course-tree views can flag videos at a glance.
_Avoid_: Lint warning, Lint error, Danger (reserved for the per-clip text-similarity signal until it is renamed to a Video Warning kind), Authoring issue

**Missing Chapters**:
The Video Warning kind raised when a **Video** has at least one **Clip** but no **Chapter** positioned before its first clip in timeline order. Models the YouTube convention that every published video opens with a named chapter. Videos with zero clips do not raise this warning. Surfaced in the UI as "Missing chapters".
_Avoid_: Missing Opening Chapter (the former name), Missing opening section, No intro chapter, Missing 0:00 chapter

### Video export and hashing

**Export Hash**:
A SHA256 hash derived from a video's clip filenames, timestamps, clip order, long-pause flags, format, and the Export Version Key; determines whether a video needs re-export. It must name everything the renderer acts on — a clip property that changes the exported bytes but not the hash leaves a stale export addressable, and the Publish ships it.
_Avoid_: Content hash, Video hash

**Exported Video**:
A rendered `.mp4` file on disk named `{courseId}-{exportHash}.mp4` in the finished videos directory.
_Avoid_: Finished video, Output video

**Unexported Video**:
A video whose current Export Hash does not match any file on disk; blocks publishing.
_Avoid_: Dirty video, Stale video

**Purge**:
The deliberate deletion of an Exported Video's `.mp4` file from disk, transitioning it back to an Unexported Video; reversible via re-export.
_Avoid_: Clear, Delete from file system, Unexport

### Recording

**Recording Session**:
A time-bounded window during which clips are captured via OBS, grouping optimistic clips before persistence.
_Avoid_: Session, Take session

**Silence Length**:
A per-Recording-Session setting (`short` or `long`) for how long a silence must last to end a clip: `short` (default) cuts on brief mid-sentence pauses, `long` only on extended ones. Locked at recording start; applied symmetrically to the frontend speech detector and backend FFmpeg silence detection.
_Avoid_: Pause Length (former name — reused "Pause", now the clip-level held pause), Silence mode, Silence sensitivity, Pause threshold

**Pause**:
A clip-level marker (`none`/`long`) that inserts a short held pause after a **Clip** in the edit — `long` holds ~0.18s, `none` is an ordinary clip. Toggled per clip, shown as an ellipsis ("…"). An enum, not a boolean, so it can gain more lengths later. Distinct from **Silence Length** (the recording cut threshold).
_Avoid_: Beat (former `beatType`), Silence Length, Gap, Hold

**Insertion Point**:
The position in a video timeline where new clips or chapters will be added (start, after-clip, after-chapter, end).
_Avoid_: Cursor, Drop target

**Transcription**:
The process of populating a clip's `text` field from its audio, tracked by `transcribedAt`.
_Avoid_: Caption, Subtitle

### Pitches

**Pitch**:
A reusable packaging artifact — the YouTube/newsletter/tweet copy and thumbnail concept for a video idea — authored _before_ the video itself is recorded. A Pitch is independent of the Course hierarchy; it relates only to **Standalone Videos**.
_Avoid_: Idea, Concept, Draft (overloaded with Draft Version)

**Pitch State**:
A Pitch's state, derived (never stored) from its linked **Deliverables'** **Deliverable Status**: **Idle** (none linked), **Scheduled** (some linked, not all terminal), **Shipped** (all terminal — `done`/`cancelled`). Abandonment is separate: a Pitch is hidden by **Archive**, not Pitch State.
_Avoid_: Pitch Status (no stored status field), Desk State, Pipeline state

**Effort**:
A manual planning estimate on a **Pitch** of the eventual video's production work: `low` (1), `medium` (2, default), `high` (3), stored as an integer mirroring **Priority**. Lives on the Pitch because it is a triage input used _before_ the video exists. Within a priority band, low-effort sorts first ("low-hanging fruit"); effort never overrides priority across bands.
_Avoid_: Estimate, Cost, Size, Complexity

**Default Pitch Filter**:
The pitches index defaults to **Idle + Scheduled**; a reveal toggle brings **Shipped** into view. At the default the filter URL param is omitted, so `/pitches` bookmarks survive default changes.

### Reference video

**Reference Video**:
Another **Video** on the same **Lesson**, opened alongside the one being recorded so the author can read its **Clip** transcripts (grouped by **Chapter**) while re-recording. No FK — the candidate set is "other non-archived Videos on this Lesson". Opt-in per editor session via the actions menu ("Add Reference"); the panel never auto-selects. With no eligible siblings the action is unavailable.
_Avoid_: Previous Take (implies take-history we don't model), Reference Take, Source Video

### Diagrams

**Diagram**:
A named, persistent identity in the diagrams sidebar — the "home" for a series of snapshots that evolve across the **Clips** it appears in. Conceptually a lineage, surfaced in the UI as a single item. Independent of the Course hierarchy; a Diagram can be referenced from Clips in any **Video** (lesson-bound or **Standalone Video**).
_Avoid_: Drawing, Sketch, Canvas, Scene (Scene is TLDraw's term for its scene JSON — reserved for that)

**DiagramSnapshot**:
An immutable capture of a Diagram's TLDraw scene at the moment a specific **Clip** was filmed. Pinned to a Clip so that returning to that Clip later surfaces the diagram state it was filmed against, even after the Diagram has been edited for subsequent clips.
_Avoid_: Frame, Revision, Checkpoint, Version (overloaded with **CourseVersion**)

**Active Diagram**:
The Diagram currently loaded into the playground's TLDraw canvas. May be `null` — in which case the playground is on its **Playground Home** screen instead. Set by picking a Diagram on Playground Home or by the "New Diagram" action (loads `headScene` into the canvas); persists across **Clips** until changed.
_Avoid_: Current diagram, Open diagram

**Playground Home**:
The diagram-less mode of the Diagram Playground popup: a full-window picker/grid for browsing existing Diagrams and creating new ones. The popup is in this mode if there is no **Active Diagram**. Distinct from the active canvas mode; switching between the two is an in-popup navigation, not a window-open event.
_Avoid_: Diagram picker, Diagrams page (overloaded with the deprecated parent route)

**Preserved Snapshot**:
A **DiagramSnapshot** flagged to stay visible in its Diagram's timeline even with no non-archived **Clip** pinning it. Created via "Preserve snapshot" (forks `headScene` into a Clip-independent snapshot) or silently auto-created when **Restore to Head** would overwrite an unpreserved head. Non-preserved snapshots vanish when all pinning Clips are archived; Preserved ones don't. Preserved and pinned are independent reasons to keep a snapshot visible. Shown as a pill on the timeline thumbnail.
_Avoid_: Manual snapshot, Saved snapshot, Standalone snapshot, Bookmark

**Restore to Head**:
Loading an older **DiagramSnapshot**'s scene back into the Active Diagram's `headScene`, replacing the live canvas. When triggered from a search-result click, the outgoing head is silently auto-preserved first (no dialog; see **Preserved Snapshot**). When triggered from the timeline's Restore button or by a **Snapshot Step**, `RestoreSnapshotDialog` confirms the action — but only when the outgoing head's content is held by no snapshot on the timeline; content already sitting there (**Preserved** _or_ Clip-pinned) is one click away, so replacing it loses nothing and the restore goes through silently. Whichever route was taken, the camera is then centred on the restored content (never zoomed past 100%) — camera state is not persisted (ADR 0003), so without that the restore lands off-screen. No-op when the head already matches the target snapshot.
_Avoid_: Revert, Roll back, Undo

**Snapshot Step**:
Moving one place along the Active Diagram's timeline with `Ctrl-[` (older) / `Ctrl-]` (newer), performing a **Restore to Head** on whatever it lands on. There is no stored cursor: position is read back off the head's content hash, so unsaved edits sit just past the newest snapshot (the first step back lands _on_ it), and consecutive snapshots holding identical content count as one place. The timeline is a ring — stepping off the newest end comes back on the oldest, and vice versa — so there is no end to be stopped at; the only timeline with nowhere to step is one holding no place to stand other than where the head already is. Works in Focus Mode, where the timeline is hidden.
_Avoid_: Undo/redo (this walks the timeline, not tldraw's history), Prev/next snapshot, Scrub

**Component**:
A named, immutable fragment of a tldraw scene — captured from a selection on the canvas and re-insertable into any Diagram via the command palette. Stored flat as the bare `TLContent` produced by `editor.getContentFromCurrentPage`, with a thumbnail and a last-used timestamp. Has no snapshot history, no lineage, and no relationship to any Diagram: capturing one copies the shapes out, and the source Diagram can change or be deleted without affecting it. Rename and delete are the only mutations; deletion is permanent.
_Avoid_: template, stencil, symbol, DiagramComponent (there is no such record on a Diagram), "saved selection"

**Command Palette**:
The `Cmd+K` modal inside the **Active Diagram** window — the single keyboard surface for inserting an **Icon** or a **Component**, replacing a selected Icon, saving a selection as a Component, searching all Diagrams by content, and mirroring the snapshot and diagram actions the surrounding chrome already offers. Invisible until summoned, so it survives tldraw Focus Mode (ADR 0004). Exists in the Active Diagram window only, never on **Playground Home**. `Cmd/Ctrl+F` is a second way in, landing straight on the diagram search with the root list still underneath it — find-in-page has nothing to find on a canvas of shapes, and searching Diagram contents is what an author meant by it. Unlike `Cmd+K` it never dismisses: pressed on an already-open palette it walks to the search, from whatever page the author was standing on.
_Avoid_: Command bar, Quick actions, Spotlight, Omnibox

**Icon**:
A vector-native lucide glyph on a Diagram's canvas, stored as a `cvm-icon` shape carrying the icon's **name** and never its geometry. The geometry lives in a vendored, append-only table committed to the repo, so a Diagram renders its icons exactly as it did when it was filmed. An icon contributes its name to content search. The icon picker sorts recently inserted names to the top of its results, ahead of every textual ranking except a name or lucide alias typed out in full — that history is per-browser (there is no record on an Icon to hang a last-used timestamp off, unlike a **Component**).
_Avoid_: Glyph, Symbol, Image (icons are deliberately not assets — ADR 0003)

**Replace Icon**:
Pointing an **Icon** already on the canvas at a different glyph, from the **Command Palette** with exactly one Icon selected. Rewrites the shape's `name` and nothing else, so the size it was resized to, its position, rotation, colour, dash, parent frame and bound arrows all survive — the difference from inserting a second Icon and deleting the first. Absent from the palette for any other selection, since two Icons or a mixed selection has no unambiguous target.
_Avoid_: Swap icon, Change icon, Edit icon (an Icon has no edit mode — `canEdit` is false)

### Video destinations

**Skills Changelog**:
A published AI Hero entity bundling an article and a Kit newsletter draft for one **Video**. Created via `POST /api/skills/changelog`; publishes immediately and triggers Inngest `skill-changelog/published`, which creates a Kit newsletter draft (template `5176054`, from `matt@aihero.dev`) — drafts only, never sends. Newsletter required; article + newsletter authored on one page. Public at `https://www.aihero.dev/skills/<slug>`, with a footer linking back.
_Avoid_: Changelog (ambiguous with course publish changelog), Skill post, Changelog entry

### Deliverables and scheduling

**Deliverable**:
A manually-authored entry on the **Deliverables Calendar**, pinned to a single all-day date — its `date` is the only date-of-intent in the schema (nothing else carries a deadline). May link to zero or more **Courses** and/or **Pitches**; the Deliverable's own state is never derived, but a linked Pitch's **Pitch State** is derived from it. Archived Deliverables are hidden from both the active calendar and the history disclosure — archive is the only hide.
_Avoid_: Task, Item, Scheduled work, Ship target

**Deliverable Status**:
A manual marker on a **Deliverable**: `planned` (default), `done`, or `cancelled`. All transitions reversible; never derived from linked entities. "Manual" means _underived_, not hand-typed: the app and an agent (`cvm deliverable`) author it the same way (ADR 0022). Distinct from **Archive** — `cancelled` Deliverables stay on the calendar; archiving is what hides them.
_Avoid_: Completion, Deliverable state

**Deliverables Calendar**:
The in-app view of all **Deliverables** across past and future dates, used for both forward planning and inventory.
_Avoid_: Delivery calendar, Schedule, Roadmap, Content calendar

**ISO Week**:
ISO 8601 week numbering (weeks start Monday; week 1 contains the year's first Thursday). Surfaces as `Week N` in the agenda header.
_Avoid_: Calendar week, Week number (without "ISO" qualifier)

### Ordering and lifecycle

**Fractional Index**:
A string-based ordering value that allows inserting items between existing items without reindexing siblings.
_Avoid_: Sort order, Position

**Archive**:
Soft-deletion: hiding an entity from active views while retaining it in the database.
_Avoid_: Delete, Remove

**ARCHIVE Section**:
A special section directory whose name ends in `ARCHIVE`, filtered out of the default course view.

### Dependencies

**Lesson Dependency**:
A directed edge from one **Lesson** to an earlier one it builds on, stored as a list of lesson IDs on `lesson.dependencies`. Conceptually points backward (a lesson depends on prerequisites above it); a dependency on a _later_ lesson is an **Order Violation**, warned-about but not blocked. Cycles are blocked at creation.
_Avoid_: Prerequisite link, Edge (unqualified)

**Order Violation**:
A persisted state where a **Lesson** depends on another lesson ordered _after_ it (within a section, or in a later section). Surfaced as a non-blocking warning on reorder and as a per-lesson indicator; never prevented, so violations can exist in saved state.
_Avoid_: Broken dependency, Invalid order

**Dependency Group**:
A maximal run of _contiguous_ lessons within one **Section**, in display order, chained by **Lesson Dependencies**: walking top-to-bottom, a lesson joins the group iff it directly depends on a lesson already in it. Purely within-section, contiguous, directed-backward — gap-spanning or forward (**Order Violation**) dependencies are not represented. Shown as dashed lines between adjacent lesson icons (a group of one shows none); suppressed while a search/filter is active. Read-only visual grouping, distinct from **Section**.
_Avoid_: Dependency block, Cluster, Chain, Lesson group
