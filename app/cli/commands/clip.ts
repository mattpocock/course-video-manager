import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  notFoundMany,
  parseError,
} from "@/cli/helpers";
import { withBackupCoordination } from "@/cli/backup-coordinator";
import {
  CLIP_ZOOM_TYPES,
  type ClipZoomType,
} from "@/features/videos/clip-zoom";

/**
 * clip — a timestamped slice of source footage inside a Video.
 *
 * DOMAIN (see CONTEXT.md "Video and clips"):
 *   A Clip is one captured segment of source footage living on a Video's
 *   recorded timeline. It is defined by a source filename
 *   (`videoFilename`) and an in/out window into that file
 *   (`sourceStartTime`/`sourceEndTime`, in seconds). Clips and Chapters share
 *   a single fractional `order` space (varchar collate-C keys) — interleaving
 *   them in timeline order is exactly what produces the Video's Transcript.
 *   A Clip's `text` is the spoken transcription, populated from its audio
 *   (Transcription) and timestamped by `transcribedAt`. An "Effect Clip" is a
 *   special clip for non-speech content (white noise, transitions) inserted by
 *   hand. `pauseType` is the held pause after the clip ("none" or "long").
 *
 *   Clips are CHILDREN of a Video, addressed only by id. There is no version
 *   scoping here — clips belong to the live recorded timeline of one Video.
 *   Archived clips are treated as deleted: they are ALWAYS filtered out and
 *   never surfaced (no --archived flag on this noun).
 *
 * OUTPUT FIELDS:
 *   id               clip id (use with `clip get`)
 *   videoId          parent Video id
 *   videoFilename    source footage file this clip is cut from
 *   sourceStartTime  in-point into the source file, seconds (float)
 *   sourceEndTime    out-point into the source file, seconds (float)
 *   order            fractional-index sort key (shared with Chapters)
 *   text             spoken transcription of the clip (the Transcript unit)
 *   transcribedAt    when `text` was last produced (null = not transcribed)
 *   scene / profile  optional capture metadata
 *   pauseType         held pause after clip; "none" or "long"
 *   zoomType          Clip Zoom; "none" or "subtle" (camera scenes only)
 *   diagramSnapshotId pinned DiagramSnapshot filmed against this clip, if any
 *   archived         always false in CLI output (archived rows are hidden)
 *   createdAt        row creation timestamp
 *
 * VERBS:
 *   clip list --video <videoId>   every active clip on a Video, timeline order
 *   clip get <id...>              one or more clips by id (variadic)
 *   clip update --zoom <t> <id>   set the Clip Zoom (the ONLY writable field)
 *
 * `update` is deliberately the narrowest possible write. A Clip's text is
 * recorded truth (the Transcript is derived from it) and its timings are the
 * cut — none of that is the CLI's to rewrite. Only the Clip Zoom, an editorial
 * choice about the shot, is writable here, and only on a camera scene.
 *
 * Clips are leaf timeline rows — there is no `clip tree`. To explore a Video's
 * structure use `video tree`, then resolve ids with `clip get`.
 *
 * EXAMPLES:
 *   # All clips on a video, in timeline order (NDJSON):
 *   cvm clip list --video vid_123
 *
 *   # Just the transcript text of each clip:
 *   cvm clip list --video vid_123 | jq -r '.text'
 *
 *   # Find untranscribed clips:
 *   cvm clip list --video vid_123 | jq 'select(.transcribedAt == null) | .id'
 *
 *   # tree -> get workflow: pull clip ids off a video skeleton, then fetch them:
 *   cvm video tree --depth all vid_123 \
 *     | jq -r '.. | objects | select(.kind=="clip") | .id' \
 *     | xargs cvm clip get
 */
const CLIP_HELP = `clip — a timestamped slice of source footage on a Video's recorded timeline.

A Clip is one captured segment of source footage, defined by a source filename and an in/out
window into it (sourceStartTime/sourceEndTime, seconds). Clips and Chapters share one fractional
'order' space; interleaving them in order is what forms the Video's Transcript. A clip's 'text' is
its spoken transcription. Clips are children of a Video, addressed by id only; there is no version
scoping and archived clips are always hidden (no --archived flag).

Verbs:
  clip list --video <videoId>   every active clip on a Video, in timeline order (NDJSON)
  clip get <id...>              fetch one or more clips by id (variadic)
  clip update --zoom <t> <id>   set the Clip Zoom ("none" | "subtle")

'update' accepts --zoom and nothing else: a clip's text is recorded truth and its timings are the
cut, neither of which the CLI rewrites. There is no 'clip tree' (clips are leaves) — use
'video tree' then 'clip get'.`;

const UPDATE_HELP = `Set a Clip's Clip Zoom.

A Clip Zoom renders the clip slightly tighter than frame, so a run of face-only camera clips has
some visual change across its cuts. Levels: "none" (as filmed) and "subtle".

Only camera scenes can be zoomed — 'Camera' and 'TikTok Face'. Anything else (a 'Code' clip, or a
clip filmed before CVM recorded scenes and so having none) is refused with exit 3; the message says
which of the two it was. The zoom reaches the Export Hash, so setting it marks the Video for
re-export, and it shows in the editor preview exactly as it will export.

NOTE ON FLAG ORDER
  --zoom must come BEFORE the positional id ('update --zoom subtle <id>', NOT
  'update <id> --zoom subtle') — a flag placed after the id is rejected with a MissingValue
  ParseError (exit 3). This is how every verb on every noun parses.

Examples:
  cvm clip update --zoom subtle clip_abc
  cvm clip update --zoom none clip_abc

  # Zoom every camera clip on a video:
  cvm clip list --video vid_123 \
    | jq -r 'select(.scene == "Camera") | .id' \
    | xargs -n1 cvm clip update --zoom subtle`;

const LIST_HELP = `List every active (non-archived) Clip on a Video, in timeline order.

Requires --video <videoId>: the parent Video whose clips to source. Derived from the Video's
clip set (getVideoWithClipsById), already ordered by the shared clip/chapter 'order' key, so the
output reflects the recorded timeline. Output is NDJSON — one compact clip object per line; an
empty video prints nothing and exits 0. An unknown video id is a not-found error (exit 2).

Each line is identity-rich (id, videoId, order, text) so an agent can map content to ids in one
call, then drill in with 'clip get'.

Examples:
  cvm clip list --video vid_123
  cvm clip list --video vid_123 | jq -r '.text'
  cvm clip list --video vid_123 | jq 'select(.transcribedAt==null) | .id'`;

const GET_HELP = `Fetch one or more Clips by id. Variadic: 'clip get <id> [<id> ...]'.

Backed by the native multi-id getter (getClipsByIds), so many ids resolve in a single query.

Output contract:
  - one id, found     -> a single pretty-printed JSON object (exit 0)
  - one id, missing   -> NotFoundError on stderr, exit 2
  - many ids          -> NDJSON of the FOUND clips on stdout; if any id is missing, those ids are
                         reported on stderr and the process exits 2 (stdout stays pure data)

Args are ids ONLY (never names/paths). Find ids first with 'clip list --video <id>' or 'video tree'.

Examples:
  cvm clip get clip_abc
  cvm clip get clip_abc clip_def clip_ghi
  cvm clip get clip_abc | jq '{id, text, start: .sourceStartTime, end: .sourceEndTime}'`;

const videoOpt = Options.text("video").pipe(
  Options.withDescription("Parent Video id whose clips to list")
);

const listCmd = Command.make("list", { video: videoOpt }, ({ video }) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const found = yield* videoOps
      .getVideoWithClipsById(video)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", video)));
    yield* emitNdjson(found.clips);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    // Clip is a leaf noun: archived = deleted, ALWAYS hidden (no flag). The
    // shared getClipsByIds has no archived filter, so the CLI enforces the
    // contract here — archived ids fall through to the not-found path (exit 2).
    const rows = (yield* clipOps.getClipsByIds(ids)).filter((r) => !r.archived);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const found = ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    const missing = ids.filter((id) => !byId.has(id));

    if (ids.length === 1) {
      if (found.length === 1) {
        yield* emitObject(found[0]);
        return;
      }
      return yield* notFound("clip", ids[0]!);
    }

    yield* emitNdjson(found);
    if (missing.length > 0) {
      return yield* notFoundMany("clip", missing);
    }
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const zoomOpt = Options.choice("zoom", CLIP_ZOOM_TYPES).pipe(
  Options.withDescription(
    `Clip Zoom to set: ${CLIP_ZOOM_TYPES.join(" | ")}. Camera scenes only.`
  )
);

const idArg = Args.text({ name: "id" });

const updateCmd = Command.make(
  "update",
  { id: idArg, zoom: zoomOpt },
  ({ id, zoom }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        const clipOps = yield* ClipOperationsService;

        // Resolve first, so a bad id is a clean not-found (exit 2) rather than
        // arriving as a service failure. Archived clips are deleted as far as
        // this noun is concerned, so they are not-found too.
        const [existing] = yield* clipOps.getClipsByIds([id]);
        if (!existing || existing.archived) {
          return yield* notFound("clip", id);
        }

        // setClipZoom re-checks eligibility — it is the service that owns the
        // rule. Translating its failure here is only about the exit code: an
        // ineligible clip is bad input (exit 3), not an internal fault.
        const updated = yield* clipOps
          .setClipZoom(id, zoom satisfies ClipZoomType)
          .pipe(
            Effect.catchTag("ClipNotZoomableError", (e) =>
              parseError(e.message, "clip")
            )
          );

        yield* emitObject(updated);
      })
    )
).pipe(Command.withDescription(detail(UPDATE_HELP)));

export const clipCommand = Command.make("clip").pipe(
  Command.withDescription(detail(CLIP_HELP)),
  Command.withSubcommands([listCmd, getCmd, updateCmd])
);
