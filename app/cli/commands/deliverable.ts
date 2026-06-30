import { Args, Command } from "@effect/cli";
import { Effect } from "effect";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { detail, emitGet, emitNdjson, withName } from "@/cli/helpers";

// ---------------------------------------------------------------------------
// Help text — domain-teaching prose (keep in sync with CONTEXT.md,
// "Deliverables and scheduling").
// ---------------------------------------------------------------------------

const DELIVERABLE_HELP = `Deliverable — a dated entry on the Deliverables Calendar.

A Deliverable is a manually-authored, all-day calendar entry pinned to a single
date. It represents a planned (or shipped) piece of output and may link to zero
or more Courses and/or Pitches. The Deliverables Calendar is the in-app view of
ALL Deliverables across past and future dates, used for both forward planning
and inventory.

A Deliverable's OWN state is never derived — its Deliverable Status is set by
hand. But the linkage flows the other way: a linked Pitch's Pitch State IS
derived from the Deliverable Status of the Deliverables it links to (a Pitch is
idle with no Deliverable, scheduled while any linked Deliverable is non-terminal,
shipped once all are terminal).

DELIVERABLE STATUS (manual, never derived)
  A manual marker on the Deliverable; all transitions are reversible:
    - planned   — the default; work is intended but not finished.
    - done      — terminal; the output shipped.
    - cancelled — terminal; abandoned, but STILL shown on the calendar.
  'done' and 'cancelled' are the two TERMINAL statuses (the ones that flip a
  linked Pitch to 'shipped'). Status is distinct from Archive.

ARCHIVE vs CANCELLED
  Archive is the ONLY thing that hides a Deliverable — archived Deliverables
  drop out of both the active calendar and the history disclosure. A 'cancelled'
  Deliverable is NOT hidden; it stays on the calendar. For this read-only CLI,
  archived = deleted: archived Deliverables are ALWAYS filtered out and there is
  no --archived flag on this noun.

VERBS
  list   — every active (non-archived) Deliverable, identity-rich, with its
           linked course ids and pitch ids. No tree (Deliverables are leaves).
  get    — one or more Deliverables by id (ID-only, variadic).

EXAMPLES
  cvm deliverable list
  cvm deliverable list | jq -r '[.date, .status, .title] | @tsv'
  cvm deliverable list | jq 'select(.status == "planned")'
  cvm deliverable get <id>
  cvm deliverable get <id-a> <id-b>          # NDJSON, one object per line
  cvm deliverable get <id> | jq '.courseIds'`;

const LIST_HELP = `List the FULL set of active (non-archived) Deliverables.

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

const GET_HELP = `Get one or more Deliverables by id (ID-only, variadic).

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

// ---------------------------------------------------------------------------
// Shaping — flatten the join rows into id arrays for an identity-rich record.
// ---------------------------------------------------------------------------

const shape = (row: {
  readonly deliverablesCourses: ReadonlyArray<{ courseId: string }>;
  readonly deliverablesPitches: ReadonlyArray<{ pitchId: string }>;
}) => {
  const { deliverablesCourses, deliverablesPitches, ...rest } = row;
  return withName({
    ...rest,
    courseIds: deliverablesCourses.map((c) => c.courseId),
    pitchIds: deliverablesPitches.map((p) => p.pitchId),
  });
};

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const svc = yield* DeliverableOperationsService;
    const rows = yield* svc.listDeliverables();
    yield* emitNdjson(rows.map(shape));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

// There is no get-by-id getter on the Deliverable service, so synthesize one by
// filtering the complete-set listDeliverables. An absent id resolves to
// undefined (the CLI owns not-found detection; emitGet maps it to exit 2).
const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "deliverable",
    ids,
    fetch: (id) =>
      Effect.flatMap(DeliverableOperationsService, (svc) =>
        svc.listDeliverables().pipe(
          Effect.map((rows) => {
            const match = rows.find((r) => r.id === id);
            return match ? shape(match) : undefined;
          })
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// Noun
// ---------------------------------------------------------------------------

export const deliverableCommand = Command.make("deliverable").pipe(
  Command.withDescription(detail(DELIVERABLE_HELP)),
  Command.withSubcommands([listCmd, getCmd])
);
