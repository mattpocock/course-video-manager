# Course Video Manager

A tool for authoring courses as structured collections of sections, lessons, and videos — held entirely in the database and published as immutable snapshots (`.mp4` files plus a `course.json`).

## Language

### Course structure

**Course**:
The primary domain entity: a structured collection of versions, sections, lessons, and videos, held entirely in the database. Not backed by any on-disk repository — courses were once backed by a local git repo, but that backing was retired (see ADR 0018).
_Avoid_: Repo, Project

**Section**:
A grouping of lessons within a course version, ordered by fractional index. Identity is carried by its `title` (uniqueness enforced per-parent by `order`); its display path is derived from title, not stored.
_Avoid_: Module, Unit

**Lesson**:
A single learning unit within a section. A pure database record — no on-disk folder. Identity is carried by its `title` (uniqueness per-parent by `order`).
_Avoid_: Exercise, Tutorial, Step

### Course versions

**CourseVersion**:
A snapshot of a course's section/lesson/video structure at a point in time; either a Draft Version or a Published Version.
_Avoid_: Version (too vague), Revision

**Draft Version**:
The single mutable CourseVersion that is currently being edited; always the latest by `createdAt`; has no name or description.
_Avoid_: Current version, Working version

**Published Version**:
An immutable CourseVersion with a name and description, created by the Publish flow; cannot be deleted.
_Avoid_: Released version, Committed version

**Publish**:
The atomic operation that uploads to Dropbox, freezes the Draft Version as a Published Version (setting name/description), and clones a new Draft Version. Its structure is derived from the database (not parsed from disk); its Dropbox output is exclusively `.mp4` video files plus a single `course.json` and its companion `course.schema.json` (the JSON Schema describing course.json, referenced by course.json's `$schema` field) — no authoring sidecar files (`.transcript.md`, `.body.md`, `.meta.json`, `TODO.md`) and no `changelog.md`.
_Avoid_: Commit, Deploy, Push

**Export Version Key**:
A hardcoded constant in the codebase (`EXPORT_VERSION`) that, when bumped, invalidates all video export hashes and forces re-export.
_Avoid_: Version number, Build version

### Authoring lifecycle

**Lesson Authoring Status**:
A per-version marker on a **Lesson** indicating where it sits in the authoring workflow. Two values: `todo` (default for every newly created lesson) and `done` (set by clicking the To-Do pill in the UI). Stored as `authoringStatus` on the lesson row and copied forward by `copyVersionStructure` at Publish, so a Published Version's lessons keep whatever status they had at publish time. Every lesson has a status (there is no longer a ghost/real distinction). Distinct from **Pitch State** (which tracks pitches, not lessons). Surfaced live via the To-Do pill and in the changelog via the **Marked Ready** / **Marked TODO** transitions.
_Avoid_: TODO flag, Completion

**Marked Ready** / **Marked TODO**:
The changelog buckets for **Lesson Authoring Status** transitions across **Published Versions** — `todo → done` and `done → todo` respectively. First-class per-section sections in the in-app changelog preview shown on the publish screen (the changelog is no longer written to disk).
_Avoid_: Completed, Reopened

### Video and clips

**Video**:
A container of clips and chapters that represents a single producible video output.
_Avoid_: Recording

**Standalone Video**:
A video with no lesson association (`lessonId = NULL`), used for reference or temporary content.
_Avoid_: Orphan video, Unlinked video

**Clip**:
A timestamped segment of source footage within a video, defined by start/end times and a source filename.
_Avoid_: Segment, Cut, Take

**Effect Clip**:
A special clip for non-speech content (white noise, transitions) manually inserted into the timeline.
_Avoid_: Filler, Spacer

**Chapter**:
A named marker/divider within a video's timeline that visually groups related clips. Maps 1:1 to YouTube chapters.
_Avoid_: Clip group, Divider, Marker, Section (ambiguous with course Section)

**Optimistic Clip**:
A clip added to the frontend state during recording before it is persisted to the database.
_Avoid_: Pending clip, Temporary clip

**Transcript**:
The ordered text projection of a **Video** — its **Clips** and **Chapters** interleaved in timeline order. The unit of comparison for changelog diffs. Changes to either Clips or Chapters are first-class changes to the Transcript: a Chapter rename, insertion, deletion, or reorder is a Transcript change in the same sense that editing a Clip's text is. Rendered with each Chapter as a `## <name>` header between paragraphs of clip text.
_Avoid_: Clip text (only covers Clips), Joined clips, Caption (reserved for the per-clip transcription product)

### Video planning

**Beat**:
A single film-time planning unit of a **Video**, classified by its **job** — what it does for the viewer. We lean into the screenwriting sense of a _beat_: a narrative unit of story/action. A Video's plan is an ordered sequence of Beats, authored _before_ the video is recorded; planning a video means choosing "one of these, then one of these". A first-class entity that belongs to a **Video** (not the **Lesson** or **Pitch**), so each Video carries its own plan and duplicating a Video copies its Beats. A Beat can be **moved between Videos** by dragging it from one video's plan into another's (reassigning its parent), but Videos themselves are not reordered — they sort alphabetically by name. Deliberately **distinct from a Chapter**: a Chapter is a recorded-timeline grouping that maps 1:1 to YouTube and groups **Clips**; a Beat is the _intended_ structure and need not correspond to any Chapter or Clip. The two are separate views — "what I planned to shoot" vs "what I shot". Five kinds, drawn from the Mise en Place glossary: **Definition**, **Walkthrough**, **Playthrough**, **Quest**, **Reaction**.
_Avoid_: Chapter (the recorded YouTube grouping), Segment (now only the transcript/silence homonym), Section (course Section), Block, Unit

**Beat Description**:
A free-text planning note on a **Beat** — "what I'm actually going to do or say here" — distinct from its short **title**. Plain text, edited inline (auto-growing textarea). A purely in-app authoring aid: like the Beat itself, it is never published (Publish skips it). Surfaced and editable on the **Section Workbench** and on the editor's **Beats tab** (the current video's plan, read while recording); deliberately **hidden on the course view**, which is already information-dense.
_Avoid_: Notes, Summary, Body, Caption

**Section Workbench**:
A drill-down authoring surface for a single **Section**, reached by clicking a **Section**'s header (lands at the top) or a **Lesson**'s title (deep-links to that lesson) in the course view. Routed at `/courses/:courseId/sections/:sectionId`. A reskin and expansion of the compact course view, scoped to one section and expanded by default, so it has the room the course view lacks: it shows each Lesson's **Videos** and their **Beats** with **Beat Descriptions** inline-editable. Its added value is the beat/description layer — structural editing (lesson/video drag-drop, context menus) is inherited from the reused course-view components rather than re-added or stripped out. Sibling sections are not shown — navigation back to them goes through the course view.
_Avoid_: Section page, Lesson page (the workbench is section-altitude; there is no lesson-altitude page), Section editor

### Video warnings

**Video Warning**:
A derived, non-blocking authoring problem surfaced on a **Video** in the UI. Computed live from the video's clips and chapters — never stored. Each warning has a stable kind (e.g. `missingOpeningChapter`). Generalizes the existing per-clip "danger" signal (Levenshtein text similarity) to the video level so course-tree views can flag videos at a glance.
_Avoid_: Lint warning, Lint error, Danger (reserved for the per-clip text-similarity signal until it is renamed to a Video Warning kind), Authoring issue

**Missing Opening Chapter**:
The Video Warning kind raised when a **Video** has at least one **Clip** but no **Chapter** positioned before its first clip in timeline order. Models the YouTube convention that every published video opens with a named chapter. Videos with zero clips do not raise this warning.
_Avoid_: No intro chapter, Missing 0:00 chapter

### Video export and hashing

**Export Hash**:
A SHA256 hash derived from a video's clip filenames, timestamps, clip order, and the Export Version Key; determines whether a video needs re-export.
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
A per-Recording-Session setting (`short` or `long`) that controls how long a silence must last before it ends a clip. `short` (default) cuts on brief mid-sentence pauses; `long` only cuts on extended pauses. Locked at the start of recording and applied symmetrically to both the frontend speech detector and the backend FFmpeg silence detection.
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
A Pitch's state, derived (never stored) from the **Deliverable Status** of its linked **Deliverables**:

- **Idle** — no linked Deliverable.
- **Scheduled** — at least one linked Deliverable, not all terminal.
- **Shipped** — at least one linked Deliverable, all terminal (`done`/`cancelled`).

Abandonment is separate: a Pitch is hidden by **Archive**, not by Pitch State.
_Avoid_: Pitch Status (no stored status field), Desk State, Pipeline state

**Effort**:
A planning estimate of how much work the eventual video will take to produce — one of three levels: `low`, `medium` (default), `high`. Lives on the Pitch (not the Video) because the estimate is a triage input used _before_ the video exists, when deciding whether the idea is worth making. Set manually; never derived. Used alongside **Priority** to rank pitches: within a given priority, a lower-effort pitch is the more attractive one to make next ("low-hanging fruit"). Effort never overrides priority — it only breaks ties within a priority band.
_Avoid_: Estimate, Cost, Size, Complexity

**Effort**:
A manual planning estimate on a **Pitch** — how much work the eventual video will take to produce. Three values: `low` (1), `medium` (2), `high` (3). Stored as an integer mirroring **Priority**; defaults to `medium`. A production metric on a packaging artifact: effort lives on the Pitch (not the Video) because it is a planning input used _before_ the video exists. Within a priority band, low-effort pitches sort first ("low-hanging fruit"); effort never overrides priority across bands. No distinct "unestimated" state — `medium + untouched` means "haven't looked yet."
_Avoid_: Complexity, Size, T-shirt size

**Default Pitch Filter**:
The pitches index defaults to **Idle + Scheduled** (everything that isn't **Shipped**); a reveal toggle brings **Shipped** into view. At the default, the filter URL param is omitted so `/pitches` bookmarks survive default changes.

### Reference video

**Reference Video**:
Another **Video** on the same **Lesson**, opened alongside the one being recorded so the author can read its **Clip** transcripts (grouped by **Chapter**) while re-recording. Not a domain link — there's no FK; the candidate set is derived as "other non-archived Videos on this Lesson." Opt-in per editor session: hidden by default, added via the editor's actions menu ("Add Reference"), and removed the same way. The visible reference is whichever sibling the user picked; the panel never auto-selects. When the Lesson has no eligible siblings, the action is unavailable and the editor stays in its default two-column layout.
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
A **DiagramSnapshot** flagged to remain visible in its Diagram's timeline regardless of whether any non-archived **Clip** pins to it. Created via the "Preserve snapshot" action in the playground, which forks `headScene` into a new snapshot independent of any Clip, or auto-created when a **Restore to Head** would overwrite an unpreserved head (silent auto-preserve). Non-preserved snapshots disappear from the timeline if all their pinning Clips become archived; Preserved Snapshots do not. A snapshot can be both Preserved _and_ pinned by Clips (the two are independent reasons to keep it visible). Surfaced in the UI via a pill on the timeline thumbnail.
_Avoid_: Manual snapshot, Saved snapshot, Standalone snapshot, Bookmark

**Restore to Head**:
Loading an older **DiagramSnapshot**'s scene back into the Active Diagram's `headScene`, replacing the live canvas. When triggered from a search-result click, the outgoing head is silently auto-preserved first (no dialog; see **Preserved Snapshot**). When triggered from the timeline's Restore button, the existing `RestoreSnapshotDialog` confirms the action. No-op when the head already matches the target snapshot.
_Avoid_: Revert, Roll back, Undo

### Video destinations

**Skills Changelog**:
A published AI Hero entity that bundles an article and a Kit newsletter draft for a single **Video**. Created via `POST /api/skills/changelog`; publishes immediately (`state: "published"`) and triggers the Inngest `skill-changelog/published` event, which creates a Kit newsletter draft (template `5176054`, from `matt@aihero.dev`) — drafts only, never sends. The newsletter is required; the article and newsletter fields are authored together on a single page. Public page at `https://www.aihero.dev/skills/<slug>`; newsletter copy includes a hardcoded footer linking back to that page.
_Avoid_: Changelog (ambiguous with course publish changelog), Skill post, Changelog entry

### Deliverables and scheduling

**Deliverable**:
A manually-authored entry on the **Deliverables Calendar**, pinned to a single all-day date. May link to zero or more **Courses** and/or **Pitches**; the Deliverable's own state is never derived, but a linked Pitch's **Pitch State** is derived from it. Archived Deliverables are hidden from both the active calendar and the history disclosure — archive is the only hide.
_Avoid_: Task, Item, Scheduled work, Ship target

**Deliverable Status**:
A manual marker on a **Deliverable**: `planned` (default), `done`, or `cancelled`. All transitions reversible; never derived from linked entities. Distinct from **Archive** — `cancelled` Deliverables stay on the calendar; archiving is what hides them.
_Avoid_: Completion, Deliverable state

**Deliverables Calendar**:
The in-app view of all **Deliverables** across past and future dates, used for both forward planning and inventory.
_Avoid_: Delivery calendar, Schedule, Roadmap, Content calendar

**ISO Week**:
ISO 8601 week numbering: weeks start on Monday and week 1 is the week containing the year's first Thursday. Surfaces as `Week N` in the agenda header. Reusable by future surfaces.
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
A maximal run of _contiguous_ lessons within a single **Section**, in display order, chained by **Lesson Dependencies**. Built by walking a section's lessons top-to-bottom: the next lesson joins the current group iff it has a **direct** dependency on any lesson already in the group; otherwise the current group closes and the next lesson begins a new one. Purely a **within-section**, **contiguous**, **directed-backward** view of relatedness — a dependency that spans a gap (a non-member lesson interrupts) or points forward (an **Order Violation**) is _not_ represented. Surfaced in the compact course view as dashed lines connecting adjacent lesson-type icons; a group of one shows no line. Suppressed entirely whenever a search or filter is active (the rendered list no longer reflects true adjacency). Read-only visual grouping — distinct from **Section** (the durable, order-backed grouping).
_Avoid_: Dependency block, Cluster, Chain, Lesson group
