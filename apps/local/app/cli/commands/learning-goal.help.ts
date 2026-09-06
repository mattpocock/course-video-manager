/**
 * Long-form --help text for the `cvm learning-goal` verbs, split out of
 * learning-goal.ts to keep that command module under the repo's per-file
 * token budget. These are domain-teaching prose strings consumed only by
 * Command.withDescription.
 */
export const HELP = `Learning Goal — the pre-Beat planning artifact for a Section.

A Learning Goal states one thing a learner should come away knowing, authored
BEFORE lessons/videos/Beats exist for the Section. It is the first step of the
authoring flow: Learning Goals -> scaffold Lessons/Videos/Beats -> Script ->
recording -> article. Learning Goals belong to a Section (not a Lesson/Video)
and carry a title, a free-text description, and a triage priority (same
convention as Lesson/Pitch: integer, lower sorts first, default 2).

Read-mostly in the UI: the Section card shows Learning Goals in a closed-by-
default collapsible, and they are NOT editable there (see 'cvm --help' —
'learning-goal' is one of the write-capable nouns). The cvm CLI is the primary
editing surface: create/update/move/delete, in addition to list/get.

Every Beat is expected to serve at least one Learning Goal of its Section: a
Section that has any Learning Goals surfaces a warning in the UI for a
Learning Goal no Beat yet serves (empty 'beatIds' below), and for a Beat that
serves none. Attach a Beat to a Learning Goal from the Beat side — see
'cvm beat --help', 'update --learning-goal'.

Output fields: id, sectionId, title, description, priority, order (sort key
within the Section), beatIds (the Beats currently serving this goal —
read-only here), archived, createdAt.

Verbs (flags come BEFORE the positional <id> — a flag after it exits 3):
  list   --section <id>            A Section's Learning Goals, ordered
  get    <id>...                   One or more Learning Goals by id
  create --section <id> [flags]    Create a Learning Goal in a Section
  update [flags] <id>              Patch title/description/priority
  move   [flags] <id>              Reorder within its Section
  delete <id>                      Archive (delete) a Learning Goal

Every write echoes the affected row as one pretty JSON object.

Examples:
  cvm learning-goal list --section sec_123
  cvm learning-goal create --section sec_123 --title "Explain closures" --priority 1
  cvm learning-goal update --description "..." lg_456
  cvm learning-goal move --after lg_789 lg_456
  cvm learning-goal delete lg_456`;

export const LIST_HELP = `List a Section's full, ordered Learning Goals as NDJSON (one compact JSON
object per line; empty list prints nothing). Requires --section <sectionId>.

Already sorted by 'order' ascending. Archived (deleted) Learning Goals are
always excluded — there is no flag to include them.

Each line carries: id, sectionId, title, description, priority (integer,
lower sorts first), order, beatIds (Beats currently serving this goal),
archived (always false), createdAt.

Find a section id with 'cvm section list' or 'cvm section tree <id>'.

Examples:
  cvm learning-goal list --section sec_123
  cvm learning-goal list --section sec_123 | jq -r '.title'`;

export const GET_HELP = `Get one or more Learning Goals by id (ID-only, variadic).

A single id prints one pretty-printed JSON object. Multiple ids print NDJSON
(one compact object per line) of the ones that were found; any missing ids
are reported on stderr and the exit code is 2 (stdout stays pure data).

Examples:
  cvm learning-goal get lg_123
  cvm learning-goal get lg_a lg_b > goals.ndjson`;

export const CREATE_HELP = `Create a Learning Goal in a Section's plan. Requires --section <sectionId>.

Flags:
  --section <id>        (required) the Section to add the Learning Goal to.
  --title <text>        short label (default "").
  --description <text>  free-text statement of what the learner should come
                        away knowing (default "").
  --priority <n>        triage rank (integer; lower sorts first; default 2).
  --before <id>         place immediately before that Learning Goal.
  --after <id>          place immediately after that Learning Goal.
                        (omit both --before/--after to append to the end.)

Echoes the created Learning Goal row (including its new id and computed
order) as one pretty JSON object. --before/--after are mutually exclusive; an
anchor that is not a Learning Goal of --section is a not-found (exit 2).

Examples:
  cvm learning-goal create --section sec_123 --title "Explain closures"
  cvm learning-goal create --section sec_123 --title "Explain closures" --priority 1 --description "The learner can describe lexical scoping."
  cvm learning-goal create --section sec_123 --title "Set up the repo" --before lg_456`;

export const UPDATE_HELP = `Patch a single Learning Goal's content by id. At least one of --title /
--description / --priority is required (an update with no fields is an
invalid-input error, exit 3).

update ONLY changes content — it never repositions the Learning Goal (use
'move' for that). Only the flags you pass change; the rest are left
untouched. Renaming is just --title (also how a UI right-click-rename would
route through, if ever added).

Flags:
  --title <text>        new short label.
  --description <text>  new free-text statement.
  --priority <n>         triage rank (integer; lower sorts first).

Echoes the updated Learning Goal row. An unknown or already-deleted id is a
not-found (exit 2). Flags must come BEFORE the <id> (a flag after it exits 3).

Examples:
  cvm learning-goal update --title "Explain closures" lg_456
  cvm learning-goal update --priority 1 --description "..." lg_456`;

export const MOVE_HELP = `Reorder a Learning Goal within its Section (it never moves between Sections —
create a new one in the target Section and delete this one for that).

Placement uses the same anchors as 'create':
  --before <id>  place immediately before that Learning Goal.
  --after  <id>  place immediately after it.
  (neither)      append to the end of the Section's list.

--before/--after are mutually exclusive and must name a Learning Goal in the
SAME Section as <id>; otherwise it is a not-found (exit 2). Echoes the moved
row with its new computed order. Flags must come BEFORE the <id> (a flag
after it exits 3).

Examples:
  cvm learning-goal move --after lg_789 lg_456   # reorder in place
  cvm learning-goal move --before lg_789 lg_456
  cvm learning-goal move lg_456                  # to the end`;

export const DELETE_HELP = `Delete (archive) a single Learning Goal by id. archived == deleted: the
Learning Goal is removed from its Section's list and can never be listed or
addressed again (there is no restore verb).

Immediate — there is no confirmation prompt (this is an agent-facing tool).
Echoes the now-archived row ({ ..., archived: true }). An unknown or
already-deleted id is a not-found (exit 2).

Example:
  cvm learning-goal delete lg_456`;
