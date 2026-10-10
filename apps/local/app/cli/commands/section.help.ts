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

ARCHIVING
  'cvm section archive <id>' (below) is a WRITE verb: a hard, one-way
  soft-delete. It sets archivedAt and the section then behaves exactly like a
  deleted row everywhere in this CLI (unlike 'cvm lesson archive', it has no
  unarchive). It is the
  ONLY thing that hides a section: a title is just a title, so naming a section
  "... ARCHIVE" hides nothing.

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
  lint <id>             Check the section's PLAN against the section-authoring
                        quality bar: orphaned Learning Goals, unlinked Beats,
                        stub Beats and quest pacing. Findings are DATA — it
                        exits 0 whether or not it finds any.
  search <id> <query>  Substring search down this section's subtree
                       (--type section|lesson|video|beat).
  create --course-version <id>|--course <id> --title <t> [--before|--after <id>]
                        Create a section in a Version (WRITE).
  rename <id> --title <t>
                        Rename a section (WRITE).
  move <id> [--before|--after <sectionId>]
                        Reorder a section within its Version (WRITE).
  archive <id>          Hard, one-way soft-delete of a section (WRITE) — see
                        "ARCHIVING" above.

IDS. A Section's 'id' changes with every Course Version (each Submit copies the
Draft with fresh ids); its 'lineageId' never does. STORE THE lineageId. Every
verb that takes a Section id also takes the lineageId, and resolves an id from an
older Version to the same Section in the current Draft, with a one-line note on
stderr naming the id it used. An id whose Section has no copy in the Draft is a
not-found (exit 2) naming its latest copy.

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

export const LIST_HELP = `List ALL Sections of one Course Version (the complete set, never a UI-bounded subset), as NDJSON — one compact JSON object per line, ordered by 'order' ascending.

By DEFAULT each line is the compact projection { id, lineageId, name } —
enough to map a section name to its id in a single call. 'lineageId' is the
stable id to store: 'id' changes with every Course Version. 'order' is omitted from this
projection: the NDJSON stream is already sorted by it, so the field would
only repeat each line's own position. 'name' is the uniform display label
every noun's 'list' carries (for a section it mirrors 'path'). Pass --full for
the complete row (order, description, repoVersionId, etc).
Lessons are NOT included either way — list goes one level deep; use 'section
get <id>' or 'lesson list --section <id>' to drill in.

You MUST scope the read to a Version:
  --course-version <id>   pin a specific Course Version (Draft or Published).
  --course <id>    resolve the course's DRAFT Version automatically.
Pass exactly one. Archived (deleted) sections are never included.

EXAMPLES
  cvm section list --course <courseId>
  cvm section list --full --course-version <versionId> | jq '{id, path}'`;

export const GET_HELP = `Get one or more Sections BY ID (variadic). A single id prints one pretty JSON object; multiple ids print NDJSON (one compact object per line) of those found. Each section is returned with its parent context (its Course Version and Course) and its ACTIVE Lessons (the section's immediate natural children).

The owning course's free-text 'memory' field is STRIPPED from that parent
context by default (it can run to 1000+ chars and is rarely what a section
command's caller wants) — pass --full to keep it, or read it directly with
'cvm course get <courseId>'.

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

This ONLY changes the section's title/display path. It never hides or archives
the section, whatever the title says — use 'cvm section archive' for that.

Edits go to the Draft: an id from a published (frozen) version resolves to its
Draft copy. Echoes the renamed section with its Version/Course hierarchy (as
'get').

EXAMPLES
  cvm section rename <sectionId> --title "A clearer title"`;

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

ONE-WAY DOOR. There is no CLI verb, no HTTP route and no UI action that
un-archives a section — reach for it accordingly.

EXAMPLES
  cvm section archive <sectionId>
  cvm section list --course <courseId> | jq -r 'select(.path=="Scratch") | .id' \\
    | xargs -n1 cvm section archive`;

export const LINT_HELP = `Check ONE Section against the section-authoring quality bar: five checks over its Learning Goals and the Beats of every Video of every active Lesson.

This is the PLANNING-stage counterpart to 'cvm course readiness'. Readiness is
course-scoped and asks "what stands between this Course and SHIPPING", over
Lesson/Video fields that reach published output. These five checks are
section-scoped and ask "is this Section's plan actually wired up", over Learning
Goals and Beats — planning artifacts Publish never emits. Neither verb reports
the other's findings, and a lint finding here never blocks a publish.

THE FIVE CHECKS
  noLearningGoals        The Section has no Learning Goals at all. Every Beat in
                         it then serves nothing, so it also lands in
                         unlinkedBeats (setup Beats aside).
  orphanedLearningGoals  A Learning Goal no Beat anywhere in the Section serves
                         (its beatIds are empty). The same predicate the course
                         view draws the "noBeats" Learning Goal Warning from.
  unlinkedBeats          A Beat whose kind is NOT 'setup' and which serves no
                         Learning Goal. One exemption: a 'setup' Beat records a
                         playground/repo requirement, not something the viewer
                         is taught. Unlike the course view's Beat Warning, a
                         Section with NO Learning Goals does NOT exempt its
                         Beats — lint flags them all (see noLearningGoals).
  stubBeats              A Beat whose description is empty or whitespace-only —
                         a placeholder carrying no plan. Applies to every kind,
                         'setup' included.
  questlessLessons       QUEST PACING. Quests should be SPREAD across the
                         Section's Lessons, not bunched into some of them, so
                         this reports each Lesson with no Quest Beat. Exempt
                         when the Section has no Quest Beat at all — that is
                         "no quests planned yet", a different and earlier
                         problem, and firing on every Lesson would drown the
                         other checks.

ARCHIVED ROWS ARE INVISIBLE THROUGHOUT
  Archived Lessons, Videos, Beats and Learning Goals are excluded before any
  check runs, and a deleted Beat's id never lingers in a Goal's beatIds, so an
  orphan is a real orphan. Linting an archived Section is a not-found (exit 2),
  not a clean report.

A FINDING IS NOT A FAILURE — EXIT 0
  Findings are DATA: they go to STDOUT and the exit code stays 0, exactly as
  'cvm course readiness' exits 0 while reporting lints. A non-zero exit would
  mean "this command could not answer", which is a different fact from "this
  Section has three stub Beats". Branch on 'clean' / 'failedChecks', never on
  the exit code. The only non-zero exits are the CLI's usual ones: 2 for an
  unknown or archived sectionId, 3 for bad input, 4/5/6 for transport, auth and
  schema-version failures.

OUTPUT (one pretty JSON object)
  sectionId              The Section checked.
  sectionTitle           Its title, echoed so a report reads without a second call.
  clean                  true when no check fires.
  failedChecks[]         Which checks fired, named — the reason 'clean' is
                         false, in one field. Empty when clean.
  counts                 One integer per check, for a cheap glance:
                         { noLearningGoals (0 or 1), orphanedLearningGoals,
                           unlinkedBeats, stubBeats, questlessLessons }.
  noLearningGoals          true when the Section has no Learning Goals at all.
  orphanedLearningGoals[]  { id, title }
  unlinkedBeats[]          { id, title, kind, videoId, videoTitle, lessonId,
                             lessonTitle } — every Beat finding carries its full
                             address, so a fix needs no lookup.
  stubBeats[]              The same shape as unlinkedBeats. A Beat can appear in
                           BOTH lists; they are independent checks.
  questlessLessons[]       { id, title, quests } — quests is always 0 here.
  questPacing              { totalQuests, lessons[] } — the whole distribution
                           the questless list was derived from, one
                           { id, title, quests } per Lesson in order, so you can
                           see the bunching rather than just its symptom.

EXAMPLES
  cvm section lint <sectionId>
  # Is this Section's plan wired up, and if not which checks failed?
  cvm section lint <sectionId> | jq -c '{clean, failedChecks, counts}'
  # Every Beat that serves no Learning Goal, addressed:
  cvm section lint <sectionId> | jq -r '.unlinkedBeats[] | "\\(.lessonTitle)/\\(.videoTitle): \\(.title)"'
  # The quest distribution across the Section's Lessons:
  cvm section lint <sectionId> | jq -c '.questPacing.lessons[]'`;
