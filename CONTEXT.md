# Course Video Manager

A tool for authoring courses as structured collections of sections, lessons, and videos — backed by a git repo on disk and published as immutable snapshots.

## Language

### Course structure

**Course**:
The primary domain entity: a structured collection of versions, sections, lessons, and videos, stored in the database.
_Avoid_: Repo (as domain entity), Project

**CourseRepo**:
The local git repository on disk that backs a course, referenced by the course's `repoPath`.
_Avoid_: Repo (ambiguous without "Course" prefix)

**Section**:
A directory-backed grouping of lessons within a course version, ordered by fractional index.
_Avoid_: Module, Unit

**Lesson**:
A single learning unit within a section, corresponding to a folder on disk.
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
The atomic operation that uploads to Dropbox, freezes the Draft Version as a Published Version (setting name/description), and clones a new Draft Version.
_Avoid_: Commit, Deploy, Push

**Export Version Key**:
A hardcoded constant in the codebase (`EXPORT_VERSION`) that, when bumped, invalidates all video export hashes and forces re-export.
_Avoid_: Version number, Build version

### Ghost entities

**Ghost Lesson**:
A lesson that exists in the database but not yet on the file system (`fsStatus = "ghost"`).
_Avoid_: Planned lesson, Draft lesson

**Ghost Section**:
A section that exists in the database but not yet on the file system.
_Avoid_: Planned section

**Ghost Course**:
A course with no file path (`filePath = NULL`); exists only in the database as a planning space.
_Avoid_: Planned course, Draft course

**Materialize**:
The act of transitioning a ghost entity to a real entity by creating its on-disk representation.
_Avoid_: Create on disk, Realize

**Materialization Cascade**:
The chain reaction when materializing a lesson inside a ghost course: assigns file path to course, materializes section, then materializes lesson — all in one flow.

### Authoring lifecycle

**Lesson Authoring Status**:
A per-version marker on a real **Lesson** indicating where it sits in the authoring workflow. Two values: `todo` (default for newly created or materialized real lessons) and `done` (set by clicking the To-Do pill in the UI). Stored as `authoringStatus` on the lesson row and copied forward by `copyVersionStructure` at Publish, so a Published Version's lessons keep whatever status they had at publish time. Subject to a biconditional invariant with `fsStatus`: a real lesson always has a status, a **Ghost Lesson** never does. Distinct from `fsStatus` (filesystem presence) and from **Pitch Status** (which tracks pitches, not lessons). Surfaced in the published output via the **TODO Marker** and in the changelog via the **Marked Ready** / **Marked TODO** transitions.
_Avoid_: TODO flag, Lesson status (ambiguous with `fsStatus`), Completion

**TODO Marker**:
A `TODO.md` sentinel file Publish writes into every real **Lesson**'s dropbox folder when its **Lesson Authoring Status** is `todo`. Fixed template, identical across all TODO lessons. Purely additive — videos and source files still publish normally. Cleaned up by the stale-file sweep when the lesson flips to `done`. Ghost Lessons never get one.
_Avoid_: Sentinel file (too generic), TODO file, Stub marker

**Marked Ready** / **Marked TODO**:
The changelog buckets for **Lesson Authoring Status** transitions across **Published Versions** — `todo → done` and `done → todo` respectively. First-class per-section sections in `changelog.md`.
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
The ordered text projection of a **Video** — its **Clips** and **Chapters** interleaved in timeline order. The unit of comparison for changelog diffs and the format shipped as `{video}.transcript.md` during **Publish**. Changes to either Clips or Chapters are first-class changes to the Transcript: a Chapter rename, insertion, deletion, or reorder is a Transcript change in the same sense that editing a Clip's text is. Rendered with each Chapter as a `## <name>` header between paragraphs of clip text.
_Avoid_: Clip text (only covers Clips), Joined clips, Caption (reserved for the per-clip transcription product)

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

**Pause Length**:
A per-Recording-Session setting (`short` or `long`) that controls how long a silence must last before it ends a clip. `short` (default) cuts on brief mid-sentence pauses; `long` only cuts on extended pauses. Locked at the start of recording and applied symmetrically to both the frontend speech detector and the backend FFmpeg silence detection.
_Avoid_: Silence mode, Silence sensitivity, Pause threshold

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

**Pitch Status**:
A manual marker on a Pitch with five values, all user-set (none derived from linked Videos):

- `idle` (default) — drafting / mulling; not yet committed to making the video
- `scheduled` — queued for delivery (typically linked from the **Deliverables Calendar**, set manually); not yet scheduled inside YouTube itself
- `shipped-to-youtube` — uploaded to YouTube and queued in YouTube's own scheduler; awaiting go-live and remaining channels (newsletter, tweet)
- `shipped` — fully delivered across channels; the Pitch is done
- `cancelled` — decided not to make this video; sideways off-ramp from any other state, reversible by flipping back to `idle`

Lifecycle ladder: `idle → scheduled → shipped-to-youtube → shipped`, with `cancelled` as a sideways off-ramp from any of them. `shipped` and `cancelled` are mutually exclusive. All transitions are reversible — the field is just a manual bookkeeping marker.

A Pitch can have any status independent of how many Videos are linked to it.

**Default Pitch Filter**:
The pitches index defaults to showing `idle + scheduled + shipped-to-youtube` — the "still on my desk" set. `shipped` and `cancelled` are hidden by default. When the filter equals this default set, the `status` URL param is omitted (bookmarks of `/pitches` survive future default changes).

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
A **DiagramSnapshot** flagged to remain visible in its Diagram's timeline regardless of whether any non-archived **Clip** pins to it. Created via the "Preserve snapshot" action in the playground, which forks `headScene` into a new snapshot independent of any Clip. Non-preserved snapshots disappear from the timeline if all their pinning Clips become archived; Preserved Snapshots do not. A snapshot can be both Preserved _and_ pinned by Clips (the two are independent reasons to keep it visible). Surfaced in the UI via a pill on the timeline thumbnail.
_Avoid_: Manual snapshot, Saved snapshot, Standalone snapshot, Bookmark

### Video destinations

**Skills Changelog**:
A published AI Hero entity that bundles an article and a Kit newsletter draft for a single **Video**. Created via `POST /api/skills/changelog`; publishes immediately (`state: "published"`) and triggers the Inngest `skill-changelog/published` event, which creates a Kit newsletter draft (template `5176054`, from `matt@aihero.dev`) — drafts only, never sends. The newsletter is required; the article and newsletter fields are authored together on a single page. Public page at `https://www.aihero.dev/skills/<slug>`; newsletter copy includes a hardcoded footer linking back to that page.
_Avoid_: Changelog (ambiguous with course publish changelog), Skill post, Changelog entry

### Deliverables and scheduling

**Deliverable**:
A manually-authored entry on the **Deliverables Calendar**, pinned to a single all-day date. May link to zero or more **Courses** and/or **Pitches**; links are informational only, never derived. Archived Deliverables are hidden from both the active calendar and the history disclosure — archive is the only hide.
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

## UI conventions

### Right-click context menus over action menus

Prefer right-click context menus (`ContextMenu` from `@/components/ui/context-menu`) over visible action-button dropdown menus (`DropdownMenu`) for entity-level actions. Context menus keep the UI clean by hiding actions behind a right-click and are the standard interaction pattern for lists, cards, and calendar items. Add the `cursor-context-menu` class to the trigger element so users discover the right-click affordance on hover.
