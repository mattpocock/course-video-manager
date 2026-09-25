import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { detail, emitNdjson, emitObject, notFound } from "@/cli/helpers";
import { resolveBeforeAnimaticItemId } from "./animatic-position";
import { ADD_HELP, HELP, LIST_HELP } from "./clip-mockup-chapter.help";

/**
 * `cvm clip-mockup-chapter` — the named dividers that group a Video's Clip
 * Mockups in its Animatic.
 *
 * NOT LOCAL-ONLY, and that is the one thing a reader trips over. Every
 * `cvm clip-mockup` verb calls `requireLocalMachine` because a frame and a WAV
 * are a directory on the author's machine. A divider is a row, so no verb here
 * has that guard and every one works on the Remote Box. The `--help` says so.
 *
 * NO DRAFT COURSE VERSION GUARD either, for the same reason the Clip Mockup
 * service has none: the guard protects the published Course Version
 * write-closure, which Clip Mockups sit outside, and their grouping follows the
 * thing it groups.
 *
 * Positions are resolved by `./animatic-position`, over the merged Clip Mockup +
 * Chapter order space — never `./timeline-position`, which is the filmed
 * timeline's space and holds no Animatic row at all.
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const videoOpt = Options.text("video").pipe(
  Options.withDescription("Parent Video id (required).")
);

const titleOpt = Options.text("title").pipe(
  Options.withDescription("The Chapter's title (its 'name'). Required.")
);

const beforeOpt = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this Clip Mockup or Chapter id (mutually exclusive with --after)."
  ),
  Options.optional
);

const afterOpt = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this Clip Mockup or Chapter id (mutually exclusive with --before)."
  ),
  Options.optional
);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The Video must exist and be active before its Animatic is read or written. */
const requireActiveVideo = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* VideoOperationsService;
    const row = yield* svc
      .getVideoDeepById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));
    if (row.archived) {
      return yield* notFound("video", id);
    }
    return row;
  });

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

const listCmd = Command.make("list", { video: videoOpt }, ({ video }) =>
  Effect.gen(function* () {
    const row = yield* requireActiveVideo(video);
    const svc = yield* ClipMockupChapterOperationsService;
    yield* emitNdjson(yield* svc.listClipMockupChaptersByVideoId(row.id));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

const addCmd = Command.make(
  "add",
  { video: videoOpt, title: titleOpt, before: beforeOpt, after: afterOpt },
  ({ video, title, before, after }) =>
    Effect.gen(function* () {
      const row = yield* requireActiveVideo(video);
      const beforeItemId = yield* resolveBeforeAnimaticItemId({
        entity: "clipMockupChapter",
        videoId: row.id,
        before,
        after,
      });
      const svc = yield* ClipMockupChapterOperationsService;
      const created = yield* svc.createClipMockupChapterAtItem(
        row.id,
        title,
        beforeItemId
      );
      yield* emitObject(created);
    })
).pipe(Command.withDescription(detail(ADD_HELP)));

export const clipMockupChapterCommand = Command.make(
  "clip-mockup-chapter"
).pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd, addCmd])
);
