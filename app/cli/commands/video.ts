import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  withName,
} from "@/cli/helpers";
import {
  formatProseTranscript,
  toTranscriptItems,
} from "@/lib/transcript-builder";

// ---------------------------------------------------------------------------
// Help text — domain-teaching prose (keep in sync with CONTEXT.md).
// ---------------------------------------------------------------------------

const VIDEO_HELP = `Video — a container of Clips and Chapters that represents a single producible video output.

A Video holds two ordered, interleaved children:
  - Clips:    timestamped slices of source footage (start/end time + a source
              filename), each carrying transcribed 'text'. Clips are the words.
  - Chapters: named markers/dividers that visually group Clips and map 1:1 to
              YouTube chapters. Chapters are the headings.
Together, projected in timeline order, Clips + Chapters form the Video's
TRANSCRIPT (see 'video transcript').

A Standalone Video has no lesson association (lessonId = NULL) and is used for
reference or temporary content; it may be packaged by a Pitch. A lesson-bound
Video belongs to a Lesson inside a Section of a Course Version.

This command exposes ONLY Standalone Videos for 'list' (the complete set, not
the UI's recent-5). 'get', 'tree' and 'transcript' accept ANY video id
(standalone or lesson-bound).

Archived Videos are soft-deleted (hidden from active views). Only Standalone
Videos have a real viewable archive — pass --archived to 'list' to see them.

Verbs:
  list                 every Standalone Video (active by default; --archived for the archive)
  get <id...>          a Video plus its Clips and Chapters (variadic; NDJSON when >1 id)
  tree <id>            skeleton: video -> clips/chapters (id/kind/name/children)
  transcript <id>      the ordered text projection (Clips + Chapters as prose)

Worked example (find a video, then read it):
  cvm video list | jq -r '.id'                     # map name -> id
  cvm video get <id> | jq '.clips | length'        # how many clips
  cvm video tree <id>                              # skeleton overview
  cvm video transcript <id> | jq -r '.transcript'  # the prose transcript`;

const LIST_HELP = `List the COMPLETE set of Standalone Videos (lessonId = NULL, pitch-bound or not).

Active videos only by default, ordered by most-recently-updated. Each row is the
full video plus its non-archived Clips, so an agent can map name -> id in one
call. Output is NDJSON (one compact JSON object per line); an empty set prints
nothing and exits 0.

Key fields:
  id         the stable video id (use with get/tree/transcript)
  name       uniform display label every noun's 'list' carries (mirrors 'path'),
             so you never have to guess the label field
  path       the video's name within its lesson (its display/file name)
  pitchId    set when a Pitch packages this standalone video; else null
  archived   soft-delete flag (always false here unless --archived)
  clips[]    the video's clips in timeline order (order, text, source times)

Flags:
  --archived   include the ARCHIVE instead: only soft-deleted Standalone Videos
               (getArchivedStandaloneVideos). Standalone Videos are the only
               videos with a viewable archive.

Examples:
  cvm video list
  cvm video list --archived
  cvm video list | jq -r '"\\(.id)\\t\\(.path)"'`;

const GET_HELP = `Get one or more Videos by id (variadic), each with its immediate children.

This is a shallow, fixed-depth read: the video row plus its non-archived Clips
(in timeline order) and Chapters, and a little parent context (its Lesson /
Section / Course Version when lesson-bound). Accepts ANY video id — standalone
OR lesson-bound.

Output:
  - exactly one id, found    -> one pretty JSON object, exit 0
  - exactly one id, missing  -> {"_tag":"NotFoundError","entity":"video",...} on
                                stderr, exit 2
  - multiple ids             -> NDJSON of the FOUND videos on stdout; any missing
                                ids are reported on stderr and the exit code is 2
                                (stdout stays pure data)

Selected fields:
  id, path, lessonId, pitchId, archived
  clips[]    { id, order, text, videoFilename, sourceStartTime, sourceEndTime,
               transcribedAt, beatType, ... } — order is a fractional index
  chapters[] { id, order, name } — named YouTube-style dividers

Examples:
  cvm video get <id>
  cvm video get <id1> <id2> <id3>
  cvm video get <id> | jq '.clips[] | .text'`;

const TREE_HELP = `Print the SKELETON of a Video: its Clips and Chapters as a shallow tree.

Each node is just { id, kind, name, children } — no full entity fields. Use this
to see a video's shape at a glance, then 'video get'/'cvm clip get' to pull
detail. A Video's natural children are its non-archived Clips (kind:"clip",
name = clip text) and Chapters (kind:"chapter", name = chapter name), interleaved
in timeline order.

Depth:
  --depth N      expand N levels (default 1 = video + its direct clips/chapters)
  --depth all    expand the full subtree
Clips and Chapters are leaves, so a Video's tree is fully expanded at depth 1.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

Examples:
  cvm video tree <id>
  cvm video tree --depth all <id>
  cvm video tree <id> | jq '.children[] | select(.kind=="chapter") | .name'`;

const TRANSCRIPT_HELP = `Render a Video's TRANSCRIPT — its ordered text projection.

The Transcript interleaves the Video's Clips and Chapters in timeline order and
renders each Chapter as a '## <name>' heading between paragraphs of clip text
(the same projection shipped as {video}.transcript.md at Publish). This is the
unit of comparison for changelog diffs.

Accepts a SINGLE video id (standalone or lesson-bound). Missing id ->
NotFoundError on stderr, exit 2.

Output is one JSON object:
  { id, path, lessonId, transcript, wordCount, items }
where 'transcript' is the rendered prose string and 'items' is the structured
sequence of { type:"section", name } / { type:"clip", text } entries.

Examples:
  cvm video transcript <id>
  cvm video transcript <id> | jq -r '.transcript'
  cvm video transcript <id> | jq '.wordCount'`;

// ---------------------------------------------------------------------------
// Shared fetch — return undefined for an absent row (CLI owns not-found).
// ---------------------------------------------------------------------------

const fetchVideoWithClips = (id: string) =>
  Effect.flatMap(VideoOperationsService, (svc) =>
    svc.getVideoWithClipsById(id)
  ).pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)));

// ---------------------------------------------------------------------------
// Tree skeleton builder
// ---------------------------------------------------------------------------

interface TreeNode {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly children?: ReadonlyArray<TreeNode>;
}

const buildVideoTree = (
  video: {
    id: string;
    path: string;
    clips: ReadonlyArray<{ id: string; order: string; text: string }>;
    chapters: ReadonlyArray<{ id: string; order: string; name: string }>;
  },
  depth: number
): TreeNode => {
  const children: TreeNode[] = [
    ...video.clips.map((c) => ({
      order: c.order,
      node: { id: c.id, kind: "clip", name: c.text },
    })),
    ...video.chapters.map((c) => ({
      order: c.order,
      node: { id: c.id, kind: "chapter", name: c.name },
    })),
  ]
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((x) => x.node);

  const node: TreeNode = { id: video.id, kind: "video", name: video.path };
  // Clips/Chapters are leaves; only the first level of children exists.
  if (depth >= 1) {
    return { ...node, children };
  }
  return node;
};

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const archived = Options.boolean("archived");

const listCmd = Command.make("list", { archived }, ({ archived }) =>
  Effect.gen(function* () {
    const svc = yield* VideoOperationsService;
    const videos = archived
      ? yield* svc.getArchivedStandaloneVideos()
      : yield* svc.getAllStandaloneVideos();
    yield* emitNdjson(videos.map(withName));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({ entity: "video", ids, fetch: fetchVideoWithClips })
).pipe(Command.withDescription(detail(GET_HELP)));

const treeId = Args.text({ name: "id" });
const depth = Options.text("depth").pipe(Options.withDefault("1"));

const treeCmd = Command.make("tree", { id: treeId, depth }, ({ id, depth }) =>
  Effect.gen(function* () {
    const levels =
      depth === "all"
        ? Number.POSITIVE_INFINITY
        : /^\d+$/.test(depth)
          ? Number.parseInt(depth, 10)
          : NaN;
    if (Number.isNaN(levels)) {
      return yield* parseError(
        `--depth must be a non-negative integer or "all" (got "${depth}")`,
        "video"
      );
    }
    const video = yield* fetchVideoWithClips(id);
    if (video === undefined) {
      return yield* notFound("video", id);
    }
    yield* emitObject(buildVideoTree(video, levels));
  })
).pipe(Command.withDescription(detail(TREE_HELP)));

const transcriptId = Args.text({ name: "id" });

const transcriptCmd = Command.make(
  "transcript",
  { id: transcriptId },
  ({ id }) =>
    Effect.gen(function* () {
      const video = yield* fetchVideoWithClips(id);
      if (video === undefined) {
        return yield* notFound("video", id);
      }
      const items = toTranscriptItems(video.clips, video.chapters);
      const transcript = formatProseTranscript(items);
      const wordCount = transcript ? transcript.split(/\s+/).length : 0;
      yield* emitObject({
        id: video.id,
        path: video.path,
        lessonId: video.lessonId,
        transcript,
        wordCount,
        items,
      });
    })
).pipe(Command.withDescription(detail(TRANSCRIPT_HELP)));

// ---------------------------------------------------------------------------
// Noun command
// ---------------------------------------------------------------------------

export const videoCommand = Command.make("video").pipe(
  Command.withDescription(detail(VIDEO_HELP)),
  Command.withSubcommands([listCmd, getCmd, treeCmd, transcriptCmd])
);
