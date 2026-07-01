import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import {
  PitchOperationsService,
  type PitchState,
  type PitchFields,
} from "@/services/db-pitch-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  withName,
} from "@/cli/helpers";

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
  create — create a Pitch (WRITE). --title required; other copy/ranking fields
           optional. (A pitch needs a title to appear in list/get.)
  update — patch a Pitch's copy/ranking fields (WRITE). Rename = --title.

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

const CREATE_HELP = `Create a Pitch. Requires --title <t>; a pitch needs a non-empty title to appear
in 'pitch list' / 'pitch get', so the title is mandatory.

All other copy and ranking fields are optional and default to their column
defaults ("" for copy; priority 2; effort 2). Echoes the created pitch row.

Flags:
  --title <t>              (required) the pitch title / packaging headline.
  --description <t>        free-text description.
  --content-plan <t>       the content plan.
  --youtube-title <t>      YouTube title copy.
  --youtube-thumbnail <t>  YouTube thumbnail concept (youtubeThumbnailDescription).
  --newsletter-title <t>   newsletter title copy.
  --tweet <t>              tweet copy.
  --priority <n>           triage rank (integer; lower sorts first).
  --effort <1|2|3>         planning effort estimate (1 low, 2 medium, 3 high).

Examples:
  cvm pitch create --title "Effect for React devs"
  cvm pitch create --title "Zod v4" --priority 1 --effort 2 --tweet "big news"`;

const UPDATE_HELP = `Patch a Pitch's copy/ranking fields by id. At least one field flag is required
(an update with no fields is invalid input, exit 3). Only the flags you pass
change; the rest are left untouched. Renaming is just --title.

Flags (all optional; same meanings as 'pitch create'):
  --title, --description, --content-plan, --youtube-title, --youtube-thumbnail,
  --newsletter-title, --tweet, --priority <n>, --effort <1|2|3>.

An unknown or archived (deleted) pitch id is a not-found (exit 2). Flags must
come BEFORE the <id>. Echoes the updated pitch row.

Examples:
  cvm pitch update --title "New title" pit_123
  cvm pitch update --priority 1 --effort 1 pit_123`;

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
// Write verbs: create / update
// ---------------------------------------------------------------------------

const optText = (name: string, description: string) =>
  Options.text(name).pipe(
    Options.withDescription(description),
    Options.optional
  );

const descriptionOption = optText("description", "Free-text description.");
const contentPlanOption = optText("content-plan", "The content plan.");
const youtubeTitleOption = optText("youtube-title", "YouTube title copy.");
const youtubeThumbnailOption = optText(
  "youtube-thumbnail",
  "YouTube thumbnail concept (youtubeThumbnailDescription)."
);
const newsletterTitleOption = optText(
  "newsletter-title",
  "Newsletter title copy."
);
const tweetOption = optText("tweet", "Tweet copy.");
const priorityOption = Options.integer("priority").pipe(
  Options.withDescription("Triage rank (integer; lower sorts first)."),
  Options.optional
);
const effortOption = Options.choice("effort", ["1", "2", "3"]).pipe(
  Options.withDescription(
    "Planning effort estimate (1 low, 2 medium, 3 high)."
  ),
  Options.optional
);

const copyOptions = {
  description: descriptionOption,
  contentPlan: contentPlanOption,
  youtubeTitle: youtubeTitleOption,
  youtubeThumbnailDescription: youtubeThumbnailOption,
  newsletterTitle: newsletterTitleOption,
  tweet: tweetOption,
  priority: priorityOption,
  effort: effortOption,
};

interface PitchFieldOpts {
  readonly description: Option.Option<string>;
  readonly contentPlan: Option.Option<string>;
  readonly youtubeTitle: Option.Option<string>;
  readonly youtubeThumbnailDescription: Option.Option<string>;
  readonly newsletterTitle: Option.Option<string>;
  readonly tweet: Option.Option<string>;
  readonly priority: Option.Option<number>;
  readonly effort: Option.Option<string>;
}

/**
 * Collect the copy/ranking flags into a partial `PitchFields`. Values may be
 * undefined (flag not passed); the service drops those before writing, so this
 * does NOT pre-filter — undefined keys count as "leave untouched".
 */
const collectPitchFields = (opts: PitchFieldOpts): PitchFields => {
  const effort = Option.getOrUndefined(opts.effort);
  return {
    description: Option.getOrUndefined(opts.description),
    contentPlan: Option.getOrUndefined(opts.contentPlan),
    youtubeTitle: Option.getOrUndefined(opts.youtubeTitle),
    youtubeThumbnailDescription: Option.getOrUndefined(
      opts.youtubeThumbnailDescription
    ),
    newsletterTitle: Option.getOrUndefined(opts.newsletterTitle),
    tweet: Option.getOrUndefined(opts.tweet),
    priority: Option.getOrUndefined(opts.priority),
    effort: effort === undefined ? undefined : Number.parseInt(effort, 10),
  };
};

const createTitleOption = Options.text("title").pipe(
  Options.withDescription("The pitch title / packaging headline (required).")
);

const createCmd = Command.make(
  "create",
  { title: createTitleOption, ...copyOptions },
  ({ title, ...rest }) =>
    Effect.gen(function* () {
      // A pitch needs a non-empty title to appear in list/get, so reject blank.
      if (title.trim() === "") {
        return yield* parseError("--title must not be empty", "pitch");
      }
      const svc = yield* PitchOperationsService;
      // One atomic insert carrying the title (never a titleless row + patch).
      const created = yield* svc.createPitch({
        title,
        ...collectPitchFields(rest),
      });
      yield* emitObject(created);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));

const updateTitleOption = Options.text("title").pipe(
  Options.withDescription("New pitch title (rename)."),
  Options.optional
);
const idArg = Args.text({ name: "id" });

const updateCmd = Command.make(
  "update",
  { id: idArg, title: updateTitleOption, ...copyOptions },
  ({ id, title, ...rest }) =>
    Effect.gen(function* () {
      const t = Option.getOrUndefined(title);
      if (t !== undefined && t.trim() === "") {
        return yield* parseError("--title must not be empty", "pitch");
      }
      // May carry undefined values (flags not passed); the service prunes them.
      const fields: PitchFields = { title: t, ...collectPitchFields(rest) };

      if (!Object.values(fields).some((v) => v !== undefined)) {
        return yield* parseError(
          "update needs at least one field flag (e.g. --title)",
          "pitch"
        );
      }

      const svc = yield* PitchOperationsService;
      // Existence + active guard (archived == deleted == not addressable).
      const existing = yield* svc
        .getPitch(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("pitch", id)));
      if (existing.archived) {
        return yield* notFound("pitch", id);
      }

      const updated = yield* svc.updatePitch(id, fields);
      yield* emitObject(updated);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

// ---------------------------------------------------------------------------
// Noun
// ---------------------------------------------------------------------------

export const pitchCommand = Command.make("pitch").pipe(
  Command.withDescription(detail(PITCH_HELP)),
  Command.withSubcommands([listCmd, getCmd, createCmd, updateCmd])
);
