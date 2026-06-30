import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import {
  PitchOperationsService,
  type PitchState,
} from "@/services/db-pitch-operations.server";
import { detail, emitGet, emitNdjson, withName } from "@/cli/helpers";

// ---------------------------------------------------------------------------
// Help text — domain-teaching prose (keep in sync with CONTEXT.md, "Pitches").
// ---------------------------------------------------------------------------

const PITCH_HELP = `Pitch — a reusable packaging artifact.

A Pitch is the YouTube/newsletter/tweet copy and thumbnail concept for a video
idea, authored BEFORE the video itself is recorded. It is independent of the
Course hierarchy; a Pitch relates only to Standalone Videos (videos with no
parent Lesson). Pitches are a triage surface: you collect ideas, rank them, and
decide which to make next.

PITCH STATE (derived, never stored)
  Each pitch carries a 'state' field derived from the Deliverable Status of its
  linked Deliverables (a Deliverable is a dated entry on the Deliverables
  Calendar that may link to Pitches and/or Courses):
    - idle      — no linked Deliverable.
    - scheduled — at least one linked Deliverable, NOT all terminal.
    - shipped   — at least one linked Deliverable, ALL terminal (done/cancelled).
  Abandonment is a SEPARATE axis: a pitch is hidden by Archive, never by state.
  Archived pitches are deleted-equivalent here and are ALWAYS filtered out (no
  --archived flag on pitch).

RANKING FIELDS
  - priority — integer triage rank (lower sorts first).
  - effort   — planning estimate of how much work the eventual video takes:
               1 = low, 2 = medium (default), 3 = high. Within a priority band a
               lower-effort pitch sorts first ("low-hanging fruit"); effort never
               overrides priority across bands.

COPY FIELDS
  title, description, contentPlan, youtubeTitle, youtubeThumbnailDescription,
  newsletterTitle, tweet — the packaging copy authored ahead of recording.

VERBS
  list   — every active pitch (optionally filtered by --state). Identity-rich.
  get    — one or more pitches by id, deep (linked Standalone Videos + their
           Clips and planning Segments).

EXAMPLES
  cvm pitch list
  cvm pitch list --state scheduled
  cvm pitch list | jq -r '.id + "\\t" + .title + "\\t" + .state'
  cvm pitch get <id>
  cvm pitch get <id-a> <id-b>            # NDJSON, one object per line
  cvm pitch get <id> | jq '.videos[].clips'`;

const LIST_HELP = `List the FULL set of active (non-archived) pitches.

Output: NDJSON — one compact JSON object per line (nothing at all when empty).
Each line is identity-rich and carries the derived Pitch State, so an agent can
map title -> id and read state in a single call:
  - id          — pitch id (use with 'cvm pitch get').
  - name        — uniform display label (mirrors title); every noun's 'list'
                  carries 'name' so you never need to guess the label field.
  - title       — the pitch title (packaging headline).
  - state       — derived Pitch State: idle | scheduled | shipped (see below).
  - priority    — triage rank (integer; lower sorts first).
  - effort      — 1 low | 2 medium | 3 high.
  - description, contentPlan, youtubeTitle, youtubeThumbnailDescription,
    newsletterTitle, tweet — the packaging copy.
  - archived    — always false here (archived pitches are filtered out).
  - createdAt, updatedAt.

Sorted by priority asc, then effort asc, then createdAt desc.

PITCH STATE is derived from the Deliverable Status of the pitch's linked
Deliverables:
  idle      — no linked Deliverable.
  scheduled — at least one linked Deliverable, not all terminal.
  shipped   — at least one linked Deliverable, all terminal (done/cancelled).

--state idle|scheduled|shipped   keep only pitches in that derived state. The UI
                                 default (Idle + Scheduled, hiding Shipped) is a
                                 UI concern; this command shows ALL states unless
                                 you pass --state.

EXAMPLES
  cvm pitch list
  cvm pitch list --state idle
  cvm pitch list --state shipped | jq -r '.title'`;

const GET_HELP = `Get one or more pitches by id (ID-only, variadic), deep.

A single id prints one pretty-printed JSON object. Multiple ids print NDJSON
(one compact object per line) of the pitches that were found; any missing ids
are reported on stderr and the exit code is 2 (stdout stays pure data).

Each pitch includes its derived 'state' (idle | scheduled | shipped) plus the
deep relations:
  - videos   — the linked Standalone Videos (active only), each with:
                 * clips    — recorded-timeline Clips (active, ordered).
                 * segments — the video's planning Segments (active, ordered):
                              {id, kind, title, description, order, videoId}.
The packaging copy fields (title, description, contentPlan, youtubeTitle,
youtubeThumbnailDescription, newsletterTitle, tweet) and ranking fields
(priority, effort) are included on the pitch itself.

EXAMPLES
  cvm pitch get <id>
  cvm pitch get <id> | jq '{title, state, videos: [.videos[].path]}'
  cvm pitch get <id-a> <id-b> > pitches.ndjson
  cvm pitch list --state idle | jq -r .id | xargs cvm pitch get`;

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const stateOption = Options.choice("state", [
  "idle",
  "scheduled",
  "shipped",
]).pipe(
  Options.withDescription(
    "Filter by derived Pitch State (idle | scheduled | shipped)."
  ),
  Options.optional
);

const listCmd = Command.make("list", { state: stateOption }, ({ state }) =>
  Effect.gen(function* () {
    const svc = yield* PitchOperationsService;
    const stateFilter = Option.getOrUndefined(state) as PitchState | undefined;
    const rows = yield* svc.listPitches(
      stateFilter ? { state: [stateFilter] } : undefined
    );
    yield* emitNdjson(rows.map(withName));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "pitch",
    ids,
    fetch: (id) =>
      Effect.flatMap(PitchOperationsService, (svc) =>
        svc.getPitchWithVideos(id).pipe(
          // The CLI owns not-found detection: an absent row must resolve to
          // undefined, never a thrown domain NotFoundError.
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
          // Archived pitches are deleted-equivalent (ALWAYS hidden, no flag):
          // treat an archived row as absent so emitGet renders NotFound + exit 2.
          Effect.map((pitch) => (pitch?.archived ? undefined : pitch))
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// Noun
// ---------------------------------------------------------------------------

export const pitchCommand = Command.make("pitch").pipe(
  Command.withDescription(detail(PITCH_HELP)),
  Command.withSubcommands([listCmd, getCmd])
);
