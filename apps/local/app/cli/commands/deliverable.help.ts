// ---------------------------------------------------------------------------
// `cvm deliverable` help text — domain-teaching prose (keep in sync with
// CONTEXT.md, "Deliverables and scheduling").
// ---------------------------------------------------------------------------

export const DELIVERABLE_HELP = `Deliverable — a dated entry on the Deliverables Calendar.

A Deliverable is a manually-authored, all-day calendar entry pinned to a single
date. It represents a planned (or shipped) piece of output and may link to zero
or more Courses and/or Pitches. The Deliverables Calendar is the in-app view of
ALL Deliverables across past and future dates, used for both forward planning
and inventory.

A Deliverable's 'date' is the ONLY date-of-intent in the CVM schema — no Course,
CourseVersion, Section, Lesson, Video or Pitch carries a deadline. If you are
scheduling work, this noun is the deadline surface.

A Deliverable's OWN state is never derived — its Deliverable Status is authored
by a deliberate act, never computed. But the linkage flows the other way: a
linked Pitch's Pitch State IS
derived from the Deliverable Status of the Deliverables it links to (a Pitch is
idle with no Deliverable, scheduled while any linked Deliverable is non-terminal,
shipped once all are terminal). Writing a Deliverable through this CLI is the
same deliberate authoring act as editing the calendar in the app: it stays
manual, just not hand-typed.

DELIVERABLE STATUS (manual, never derived)
  A manual marker on the Deliverable; all transitions are reversible:
    - planned   — the default; work is intended but not finished.
    - done      — terminal; the output shipped.
    - cancelled — terminal; abandoned, but STILL shown on the calendar.
  'done' and 'cancelled' are the two TERMINAL statuses (the ones that flip a
  linked Pitch to 'shipped'). "Terminal" describes what the status means for
  Pitch State, NOT immutability — you can always set it back to 'planned'.
  Status is distinct from Archive.

ARCHIVE vs CANCELLED
  Archive is the ONLY thing that hides a Deliverable — archived Deliverables
  drop out of both the active calendar and the history disclosure. A 'cancelled'
  Deliverable is NOT hidden; it stays on the calendar. For this CLI, archived =
  deleted: archived Deliverables are ALWAYS filtered out of 'list'/'get', are
  not addressable by 'update'/'archive', and there is no --archived flag.

LINKS
  --course <id> and --pitch <id> are REPEATABLE and take ids (resolve them with
  'cvm course list' / 'cvm pitch list'). Every id is validated: an unknown or
  archived Course/Pitch is a not-found (exit 2) and nothing is written. On
  'update' each flag REPLACES that noun's whole link set; omitting it leaves
  those links untouched; --clear-courses / --clear-pitches empty a set.

VERBS
  list    — every active (non-archived) Deliverable, identity-rich, with its
            linked course ids and pitch ids. No tree (Deliverables are leaves).
  get     — one or more Deliverables by id (ID-only, variadic).
  create  — WRITE. A new Deliverable (--title and --date required).
  update  — WRITE. Patch any subset of fields, status and links included.
  archive — WRITE. Hide a Deliverable (the only hide; not the same as
            --status cancelled).

EXAMPLES
  cvm deliverable list
  cvm deliverable list | jq -r '[.date, .status, .title] | @tsv'
  cvm deliverable list | jq 'select(.status == "planned")'
  cvm deliverable get <id>
  cvm deliverable get <id-a> <id-b>          # NDJSON, one object per line
  cvm deliverable create --title "Ship Effect course" --date 2026-08-14
  cvm deliverable update --date 2026-08-21 <id>      # slip the deadline
  cvm deliverable update --status done <id>          # mark it shipped
  cvm deliverable archive <id>`;

export const LIST_HELP = `List the FULL set of active (non-archived) Deliverables.

Output: NDJSON — one compact JSON object per line (nothing at all when empty).
Each line is identity-rich so an agent can map title/date -> id in one call:
  - id          — Deliverable id (use with 'cvm deliverable get').
  - name        — uniform display label (mirrors title); every noun's 'list'
                  carries 'name' so you never need to guess the label field.
  - title       — the Deliverable's headline.
  - date        — the all-day date it is pinned to (YYYY-MM-DD).
  - status      — Deliverable Status: planned | done | cancelled (see below).
  - notes       — free-form notes, or null.
  - archived    — always false here (archived Deliverables are filtered out).
  - createdAt, updatedAt.
  - courseIds   — ids of the linked Courses (may be empty).
  - pitchIds    — ids of the linked Pitches (may be empty).

Sorted by date asc, then createdAt asc (calendar order).

DELIVERABLE STATUS is a MANUAL marker, never derived:
  planned   — default; intended but not finished.
  done      — terminal; shipped.
  cancelled — terminal; abandoned but still on the calendar.

EXAMPLES
  cvm deliverable list
  cvm deliverable list | jq -r 'select(.status=="done") | .title'
  cvm deliverable list | jq -r '.id + "\\t" + .date + "\\t" + .status'`;

export const GET_HELP = `Get one or more Deliverables by id (ID-only, variadic).

A single id prints one pretty-printed JSON object. Multiple ids print NDJSON
(one compact object per line) of the Deliverables that were found; any missing
ids are reported on stderr and the exit code is 2 (stdout stays pure data).

Each Deliverable carries:
  - id, title, date (YYYY-MM-DD), status (planned | done | cancelled),
    notes, archived, createdAt, updatedAt.
  - courseIds   — ids of the linked Courses (may be empty). Resolve with
                  'cvm course get'.
  - pitchIds    — ids of the linked Pitches (may be empty). Resolve with
                  'cvm pitch get'.

EXAMPLES
  cvm deliverable get <id>
  cvm deliverable get <id> | jq '{title, date, status, courseIds, pitchIds}'
  cvm deliverable list | jq -r .id | xargs cvm deliverable get
  cvm deliverable get <id> | jq -r '.courseIds[]' | xargs cvm course get`;

export const CREATE_HELP = `WRITE. Create a Deliverable — a new dated entry on the calendar.

Writes immediately (no confirmation, no dry-run) and echoes the created
Deliverable as one pretty JSON object, shaped exactly like 'get' output.

FLAGS
  --title <text>       Required. The Deliverable's headline; must not be blank.
  --date <YYYY-MM-DD>  Required. The all-day date it is pinned to. Strictly
                       zero-padded ISO; a date that does not exist (2026-02-31)
                       is rejected. There is no relative-date syntax — resolve
                       "next Friday" yourself before calling.
  --notes <text>       Free-form notes. Omitted => null.
  --status <status>    planned (default) | done | cancelled. Creating straight
                       into a terminal status is legal — it is how you record
                       something that already shipped.
  --course <id>        Repeatable. Link a Course. Unknown/archived => exit 2.
  --pitch <id>         Repeatable. Link a Pitch. Unknown/archived => exit 2.

Link ids are de-duplicated. Linking a Pitch has a visible consequence: the
Pitch's derived Pitch State moves from idle to scheduled (and to shipped once
every linked Deliverable is terminal).

EXAMPLES
  cvm deliverable create --title "Ship Effect course" --date 2026-08-14
  cvm deliverable create --title "Launch week" --date 2026-09-01 \\
    --notes "two videos + newsletter" --course <course-id> --pitch <pitch-id>
  cvm deliverable create --title "Shipped last week" --date 2026-07-20 \\
    --status done`;

export const UPDATE_HELP = `WRITE. Patch an existing Deliverable (flags BEFORE the <id>).

Every flag is optional but at least one is required — passing none is an
invalid input (exit 3), never a no-op write. Fields you do not pass are left
exactly as they were. Echoes the updated Deliverable, shaped like 'get'.

This verb covers status changes too — there is no separate 'update-status':
'cvm deliverable update --status done <id>' is the whole of it.

FLAGS
  --title <text>       Rename; must not be blank.
  --date <YYYY-MM-DD>  Re-pin to another date (this is how a deadline slips).
  --notes <text>       Replace the notes. Pass "" to blank them.
  --status <status>    planned | done | cancelled. ALL transitions are legal
                       and reversible in both directions — "terminal" describes
                       what the status means for a linked Pitch's Pitch State,
                       not immutability.
  --course <id>        Repeatable. REPLACES the whole Course link set.
  --pitch <id>         Repeatable. REPLACES the whole Pitch link set.
  --clear-courses      Remove every Course link (rejects --course alongside it).
  --clear-pitches      Remove every Pitch link (rejects --pitch alongside it).

An unknown id — or an archived one, since archived is deleted-equivalent here —
is a not-found (exit 2). Nothing un-archives a Deliverable: not this CLI, not
the app. Prefer --status cancelled unless you mean it.

EXAMPLES
  cvm deliverable update --date 2026-08-21 <id>
  cvm deliverable update --status done <id>
  cvm deliverable update --status planned <id>       # reopen it
  cvm deliverable update --title "Ship v2" --notes "slipped a week" <id>
  cvm deliverable update --pitch <pitch-a> --pitch <pitch-b> <id>
  cvm deliverable update --clear-pitches <id>`;

export const ARCHIVE_HELP = `WRITE. Archive a Deliverable — the only way to hide one.

Sets archived = true. The Deliverable drops out of the calendar, out of the
history disclosure, and out of this CLI entirely: it stops appearing in 'list',
'get' returns not-found, and 'update'/'archive' can no longer address it. Echoes
the archived row (shaped like 'get', with archived: true) one last time.

ONE-WAY DOOR. Nothing in this product un-archives a Deliverable — there is no
CLI verb, no HTTP route and no UI action, so archiving is effectively a delete
you cannot undo without touching the database. Reach for it accordingly.

ARCHIVE IS NOT 'cancelled'. Use --status cancelled for work you deliberately
abandoned but want to keep SEEING on the calendar (reversible, and the usual
right answer); archive only for entries that should not have existed. Archiving
also removes the Deliverable from a linked Pitch's derived Pitch State, so a
Pitch whose only Deliverable is archived falls back to idle.

EXAMPLES
  cvm deliverable archive <id>
  cvm deliverable list | jq -r 'select(.title=="typo") | .id' \\
    | xargs -n1 cvm deliverable archive`;
