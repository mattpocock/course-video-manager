/**
 * Long-form --help text for the `cvm lesson` verbs, split out of lesson.ts
 * to keep that command module under the repo's per-file token budget. These
 * are domain-teaching prose strings consumed only by Command.withDescription.
 */
export const LESSON_HELP = `lesson — a Lesson: the leaf authoring unit inside a Section of a Course Version.

WHAT IT IS
  A Lesson belongs to one Section (sectionId) and contains Videos. Each Video is
  an ordered sequence of Clips. A lesson id is already version-scoped: every
  Course Version owns its own lesson rows (Publish copies structure forward), so
  there is no --course-version flag here — address the lesson you want by its id.

KEY FIELDS
  authoringStatus  Where a lesson sits in the authoring workflow: "todo"
                   (default for newly created lessons) or "done" (marked ready
                   in the UI).
  path             The lesson's slug/segment (often number-prefixed, e.g.
                   "01-intro"). Unique per section among non-archived lessons.
  title            Human-readable lesson title (may be empty; untitled lesson).
  order            Sort position within the section (lower sorts first).
  priority         Authoring priority hint (integer, default 2).
  sectionId        Parent Section id.

ARCHIVED
  Archived lessons are deleted lessons: they are ALWAYS filtered out and never
  shown. There is no --archived flag for lessons.

VERBS
  list --section <id>   All active lessons in a Section (NDJSON, identity-rich).
  get <id...>           One or more lessons with their Section/Version/Repo
                        hierarchy. Variadic: many ids => NDJSON.
  tree <id> [--depth N] Skeleton tree lesson -> videos -> clips.
  create --section <id> --title <t> [--before|--after <lessonId>]
                        Create a lesson in a Section (WRITE).
  update <id> --title <t>
                        Rename a lesson's display title (WRITE; slug unchanged).
  move <id> [--section <id>] [--before|--after <lessonId>]
                        Reorder within a section, or re-home to another (WRITE).
  search <id> <query>   Substring search down this lesson's subtree
                        (--type lesson|video|beat).

WRITES honour correctness: reordering or moving a lesson renumbers path prefixes.
Writes only ever target the Draft (latest) version.

EXAMPLES
  cvm lesson list --section sec_123
  cvm lesson get les_abc
  cvm lesson get les_abc les_def
  cvm lesson tree --depth all les_abc
  cvm lesson tree les_abc | jq '.children[].id'   # video ids, then: cvm video get <id>`;

export const LIST_HELP = `List every ACTIVE lesson in a Section (the complete set, not a UI-bounded slice).

Requires --section <id>. Output is NDJSON, one compact lesson object per line,
ordered by the lesson's 'order'. Each line is identity-rich (id, name, title,
path, sectionId) plus authoringStatus so an agent can map a name to an id
and judge todo-vs-done in one call. 'name' is the uniform display label every
noun's 'list' carries (for a lesson it is the title, falling back to path when
the title is empty), so you never have to guess the label field. Archived lessons
are never included. Empty section => no output, exit 0.

Example:
  cvm lesson list --section sec_123
  cvm lesson list --section sec_123 | jq -c '{id, title, authoringStatus}'`;

export const GET_HELP = `Fetch one or more Lessons by id, each with its parent hierarchy
(Section -> Course Version -> Repo).

'get' is ID-only and variadic. One id => a single pretty-printed JSON object.
Multiple ids => NDJSON of the found lessons. A missing id renders a NotFoundError
on STDERR and exits 2 (for multiple ids, found lessons are still emitted to
STDOUT first, then the missing ids are reported on STDERR). STDOUT stays pure.

See authoringStatus field meaning in 'cvm lesson --help'.

Examples:
  cvm lesson get les_abc
  cvm lesson get les_abc les_def les_ghi
  cvm lesson get les_abc | jq '{id, title, section: .section.path}'`;

export const TREE_HELP = `Print a SKELETON tree for a Lesson: lesson -> videos -> clips.

Each node is {id, kind, title|path, children} only — no full entity fields. Use
'get' once you have the id you want. 'kind' is one of "lesson", "video", "clip".

DEPTH
  --depth N    Expand N levels below the lesson. Default 1 = the lesson plus its
               direct Videos (no clips). --depth 2 (or more) adds each Video's
               Clips. The lesson tree is at most 2 levels deep.
  --depth all  Expand the full subtree (equivalent to depth 2 here).

A missing lesson id renders NotFoundError on STDERR and exits 2.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

Examples:
  cvm lesson tree les_abc
  cvm lesson tree --depth all les_abc
  cvm lesson tree --depth all les_abc | jq '.children[].children[].id'   # clip ids`;

export const CREATE_HELP = `Create a lesson inside a Section. Requires --section <id> and --title <t>.

The lesson's 'path' (slug) is derived from the title.

Flags:
  --section <id>       (required) the Section to create the lesson in.
  --title <text>       (required) the lesson title (also slugified into 'path').
  --before <lessonId>  place immediately before that lesson (of --section).
  --after  <lessonId>  place immediately after that lesson.
                       (omit both to append to the end of the section.)

--before/--after are mutually exclusive; an anchor that is not a lesson of
--section is a not-found (exit 2). A title whose slug collides with an existing
lesson in the section is invalid input (exit 3). Echoes the created lesson row
as one pretty JSON object.

Examples:
  cvm lesson create --section sec_123 --title "Intro to Effect"
  cvm lesson create --section sec_123 --title "Setup" --before les_abc`;

export const UPDATE_HELP = `Rename a lesson's display TITLE by id. Requires --title <t> (an update with an
empty title is invalid input, exit 3).

This changes the human-readable 'title' only — the lesson's 'path' (its slug) is
deliberately left untouched, so renaming never moves a URL. Editing a lesson in a
published (frozen) version is refused (exit 3); edits go to the Draft.

Echoes the updated lesson with its Section/Version/Repo hierarchy (as 'get').

Examples:
  cvm lesson update les_abc --title "A clearer title"`;

export const MOVE_HELP = `Reposition a lesson: reorder it within its Section, or re-home it to another.

  cvm lesson move <id> [--section <id>] [--before|--after <lessonId>]

  --section <id>       destination Section (omit to reorder within the lesson's
                       current section).
  --before <lessonId>  place immediately before that lesson.
  --after  <lessonId>  place immediately after that lesson.
                       (omit both anchors to append to the end of the section.)

--before/--after are mutually exclusive. Within-section, the anchor must be a
sibling; cross-section, it must live in the destination section — otherwise
not-found (exit 2). Editing a published (frozen) version is refused (exit 3).

CORRECTNESS: moving/reordering a lesson renumbers path prefixes to keep derived
paths correct.

Echoes the moved lesson with its Section/Version/Repo hierarchy (as 'get').

Examples:
  cvm lesson move les_abc --before les_def          # reorder within section
  cvm lesson move les_abc --after les_def           # reorder within section
  cvm lesson move les_abc --section sec_9            # append to another section
  cvm lesson move les_abc --section sec_9 --before les_ghi`;
