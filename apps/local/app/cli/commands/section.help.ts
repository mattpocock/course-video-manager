/**
 * Long-form --help text for the `cvm section` verbs, split out of section.ts
 * to keep that command module under the repo's per-file token budget. These
 * are domain-teaching prose strings consumed only by Command.withDescription.
 */
export const SECTION_HELP = `cvm section — Sections of a Course Version.

WHAT IS A SECTION
  A Section is a grouping of Lessons inside a single Course Version, ordered by a
  fractional 'order' index. Sections are version-scoped: every read resolves a
  Version first (the DRAFT by default, or --course-version <id> to pin a
  Published Version snapshot).

  An empty Section (no Lessons) has no derived numbered path — its path falls back
  to its title — and is skipped from the numbered view; it gains a number once it
  contains at least one Lesson. Archived (deleted) sections are ALWAYS filtered
  out and are never visible — there is no --archived flag for sections.

TWO DIFFERENT THINGS NAMED "ARCHIVE" — DO NOT CONFUSE THEM
  1. 'cvm section archive <id>' (below) is a WRITE verb: a hard, one-way
     soft-delete. It sets archivedAt and the section then behaves exactly like
     a deleted row everywhere in this CLI — same as 'cvm lesson archive'.
  2. An "ARCHIVE Section" is an unrelated, pre-existing APP convention: any
     section whose title/path ends in the literal text "ARCHIVE" is filtered
     out of the default course view in the app's UI, but is NOT archived in
     the sense above — it still shows up in 'cvm section list'/'get' like any
     other active section. Renaming a section to end in "ARCHIVE" (via 'cvm
     section rename') only hides it from that one UI view; it does not touch
     archivedAt and 'cvm section archive' is still a separate, later step if
     you actually want to delete it.

OUTPUT FIELDS
  id            section id (use with 'get' / 'tree').
  path          the section's directory name / display name (e.g. "01-intro").
  order         fractional sort key within the Version (ascending).
  description   free-text section description (default "").
  repoVersionId the Course Version this section belongs to.
  archivedAt    deletion timestamp; always null in CLI output (archived hidden),
                EXCEPT in the one-time echo from 'archive' itself.
  lessons       (get only) the section's ACTIVE Lessons.

VERBS
  list   All sections of a Version (requires --course-version <id> or --course <id>).
  get    One or more sections by id (variadic), each with its active Lessons.
  tree   Skeleton of section -> lessons -> videos.
  search <id> <query>  Substring search down this section's subtree
                       (--type section|lesson|video|beat).
  create --course-version <id>|--course <id> --title <t> [--before|--after <id>]
                        Create a section in a Version (WRITE).
  rename <id> --title <t>
                        Rename a section (WRITE).
  move <id> [--before|--after <sectionId>]
                        Reorder a section within its Version (WRITE).
  archive <id>          Hard, one-way soft-delete of a section (WRITE) — see
                        "TWO DIFFERENT THINGS NAMED ARCHIVE" above.

WRITES only ever target the Draft (latest) version.

EXAMPLES
  # All sections of a course's Draft Version, mapping name -> id:
  cvm section list --course <courseId> | jq '{id, path}'

  # Sections of a pinned Published Version:
  cvm section list --course-version <versionId>

  # Inspect one section plus its lessons:
  cvm section get <sectionId>

  # Walk the structure, then drill into a lesson (flags come BEFORE the id):
  cvm section tree --depth all <sectionId> | jq '.children[].id'

  # Create, rename, reorder, then delete a section:
  cvm section create --course <courseId> --title "New Section"
  cvm section rename <sectionId> --title "A Better Title"
  cvm section move <sectionId> --before <otherSectionId>
  cvm section archive <sectionId>`;

export const LIST_HELP = `List ALL Sections of one Course Version (the complete set, never a UI-bounded subset), as NDJSON — one compact JSON object per line, ordered by 'order' ascending. Each line carries the section's identity (id, name, path, order, repoVersionId), so an agent can map a section name to its id in a single call. 'name' is the uniform display label every noun's 'list' carries (for a section it mirrors 'path'), so you never have to guess the label field. Lessons are NOT included — list goes one level deep; use 'section get <id>' or 'lesson list --section <id>' to drill in.

You MUST scope the read to a Version:
  --course-version <id>   pin a specific Course Version (Draft or Published).
  --course <id>    resolve the course's DRAFT Version automatically.
Pass exactly one. Archived (deleted) sections are never included.

EXAMPLES
  cvm section list --course <courseId>
  cvm section list --course-version <versionId> | jq '{id, path}'`;

export const GET_HELP = `Get one or more Sections BY ID (variadic). A single id prints one pretty JSON object; multiple ids print NDJSON (one compact object per line) of those found. Each section is returned with its parent context (its Course Version and Course) and its ACTIVE Lessons (the section's immediate natural children).

Not-found: a single missing id fails with NotFoundError on stderr (exit 2). With multiple ids, found sections are still emitted to stdout and the missing ids are reported on stderr (exit 2).

EXAMPLES
  cvm section get <sectionId>
  cvm section get <id1> <id2> <id3> | jq '{id, path}'`;

export const TREE_HELP = `Print a SKELETON tree of a Section's structure: section -> lessons -> videos. Each node is minimal: { id, kind, name|title, children }. No full entity fields — use 'get' for those.

  kind "section"  -> name is the section path
  kind "lesson"   -> title is the lesson title (may be "")
  kind "video"    -> name is the video title

DEPTH
  --depth 1    (default) the section plus its direct children (lessons).
  --depth 2    also expand each lesson's videos.
  --depth all  the full subtree (section -> lessons -> videos).
Archived lessons and videos are excluded.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

EXAMPLES
  cvm section tree <sectionId>
  cvm section tree --depth all <sectionId> | jq '.children[] | {id, title}'`;

export const CREATE_HELP = `Create a Section inside a Course Version. Requires --title <t> and exactly one
of --course-version <id> / --course <id> (same scoping as 'section list').

Flags:
  --course-version <id>  pin a specific (Draft or Published) Version to create in.
  --course <id>          resolve the course's DRAFT Version automatically.
  --title <text>         (required) the section title (also its display path).
  --before <sectionId>   place immediately before that section.
  --after  <sectionId>   place immediately after that section.
                        (omit both to append to the end of the Version.)

--before/--after are mutually exclusive; an anchor that is not a section of the
resolved Version is a not-found (exit 2). Creating in a non-Draft (published)
Version is refused (exit 3) — writes only ever target the Draft. Echoes the
created section row as one pretty JSON object.

EXAMPLES
  cvm section create --course <courseId> --title "New Section"
  cvm section create --course <courseId> --title "Setup" --before <sectionId>`;

export const RENAME_HELP = `Rename a section by id. Requires --title <t> (a non-empty display title — an
empty/whitespace-only value is invalid input, exit 3).

This ONLY changes the section's title/display path — it is NOT the same as the
app's "ARCHIVE Section" convention: renaming a section so its title ends in the
literal text "ARCHIVE" hides it from the default course view in the app's UI,
but does nothing else — the section stays fully active in this CLI (still shows
in 'list'/'get', still editable). See 'cvm section --help' for the full
distinction from the destructive 'archive' verb below.

Editing a section in a published (frozen) version is refused (exit 3); edits go
to the Draft. Echoes the renamed section with its Version/Course hierarchy (as
'get').

EXAMPLES
  cvm section rename <sectionId> --title "A clearer title"
  cvm section rename <sectionId> --title "99-ARCHIVE"   # hides from the course
                                                          # view only — does NOT
                                                          # archive the section`;

export const MOVE_HELP = `Reorder a section within its Course Version.

  cvm section move <id> [--before|--after <sectionId>]

  --before <sectionId>  place immediately before that section.
  --after  <sectionId>  place immediately after that section.
                        (omit both anchors to append to the end of the Version.)

A section's parent is the Course Version itself, so — unlike 'cvm lesson move'
— there is no destination flag to re-home it elsewhere; this only reorders
siblings within the section's current Version.

--before/--after are mutually exclusive. The anchor must be a sibling section in
the same Version, and must not be the section being moved — otherwise not-found
(exit 2) / invalid input (exit 3) respectively. Editing a published (frozen)
version is refused (exit 3).

Echoes the moved section with its Version/Course hierarchy (as 'get').

EXAMPLES
  cvm section move <sectionId> --before <otherSectionId>
  cvm section move <sectionId> --after <otherSectionId>
  cvm section move <sectionId>                           # append to the end`;

export const ARCHIVE_HELP = `WRITE. Hard, one-way soft-delete of a section — the only way to delete one.

Sets archivedAt. The section drops out of this CLI entirely: it stops appearing
in 'list'/'tree', 'get' returns not-found, and 'rename'/'move'/'archive' can no
longer address it. Editing a published (frozen) version is refused (exit 3);
archiving only ever targets the Draft. Echoes the archived section (shaped like
'get', with archivedAt set) one last time — since 'archive' does not re-fetch
after the write.

DO NOT CONFUSE with the app's "ARCHIVE Section" title convention (a section
whose title ends in "ARCHIVE" is merely hidden from the default course view,
NOT deleted) — see 'cvm section --help'. This verb is the destructive one.

ONE-WAY DOOR. There is no CLI verb, no HTTP route and no UI action that
un-archives a section — reach for it accordingly.

EXAMPLES
  cvm section archive <sectionId>
  cvm section list --course <courseId> | jq -r 'select(.path=="Scratch") | .id' \\
    | xargs -n1 cvm section archive`;
