import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { ClipMockupChapterOperationsService } from "@/services/db-clip-mockup-chapter-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";
import { resolveBeforeAnimaticItemId } from "./animatic-position";
import {
  ADD_HELP,
  DELETE_HELP,
  GET_HELP,
  HELP,
  LIST_HELP,
  MOVE_HELP,
  UPDATE_HELP,
} from "./clip-mockup-chapter.help";

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

const idArg = Args.text({ name: "id" });
const idArgs = Args.text({ name: "id" }).pipe(Args.repeated);

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

/**
 * Resolve + gate a Chapter for a write. A bad id is a clean not-found (exit 2),
 * and an archived Chapter is deleted as far as this noun is concerned, so it is
 * a not-found too. Copied from `./chapter.ts`'s `requireActiveChapter`:
 * `getClipMockupChaptersByIds` returns rows of ANY archived state on purpose, so
 * the archived filter belongs here, in the CLI that owns not-found detection.
 */
const requireActiveChapter = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupChapterOperationsService;
    const [existing] = yield* svc.getClipMockupChaptersByIds([id]);
    if (!existing || existing.archived) {
      return yield* notFound("clipMockupChapter", id);
    }
    return existing;
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

const getCmd = Command.make("get", { ids: idArgs }, ({ ids }) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupChapterOperationsService;
    yield* emitGet({
      entity: "clipMockupChapter",
      ids,
      // Archived = deleted, ALWAYS hidden (no flag, no restore verb): an
      // archived id falls through to the not-found path.
      fetch: (id) =>
        svc
          .getClipMockupChaptersByIds([id])
          .pipe(Effect.map(([row]) => (row?.archived ? undefined : row))),
    });
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const updateCmd = Command.make(
  "update",
  { id: idArg, title: titleOpt },
  ({ id, title }) =>
    Effect.gen(function* () {
      yield* requireActiveChapter(id);
      const svc = yield* ClipMockupChapterOperationsService;
      yield* emitObject(
        yield* svc.updateClipMockupChapter(id, { name: title })
      );
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

const moveCmd = Command.make(
  "move",
  { id: idArg, before: beforeOpt, after: afterOpt },
  ({ id, before, after }) =>
    Effect.gen(function* () {
      const existing = yield* requireActiveChapter(id);
      // AN ANCHOR IS REQUIRED, and this is the call site that says so. The
      // resolver reads "no anchor" as "append", which is right for `add` and
      // wrong here: a divider's whole job is to sit in front of something, so
      // the end of the Animatic is no meaningful home for it. Silently sending
      // the row there would be a mis-placement, not an error.
      if (Option.isNone(before) && Option.isNone(after)) {
        return yield* parseError(
          "move needs one of --before / --after",
          "clipMockupChapter"
        );
      }
      const beforeItemId = yield* resolveBeforeAnimaticItemId({
        entity: "clipMockupChapter",
        videoId: existing.videoId,
        before,
        after,
        excludeId: id,
      });
      const svc = yield* ClipMockupChapterOperationsService;
      const moved = yield* svc
        .moveClipMockupChapterToPosition(id, beforeItemId)
        .pipe(
          Effect.catchTag("NotFoundError", (e) =>
            notFound(
              "clipMockupChapter",
              (e.params as { clipMockupChapterId?: string })
                .clipMockupChapterId ?? id
            )
          )
        );
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

/**
 * `delete` archives the divider and writes NOTHING else. Its Clip Mockups are
 * absorbed into the Chapter above — or left unchaptered, if it was the first —
 * by the implicit-membership rule, so no row is re-parented and no frame or WAV
 * is lost. Archived means deleted; there is no restore verb.
 */
const deleteCmd = Command.make("delete", { id: idArg }, ({ id }) =>
  Effect.gen(function* () {
    yield* requireActiveChapter(id);
    const svc = yield* ClipMockupChapterOperationsService;
    yield* svc.archiveClipMockupChapter(id);
    const [archived] = yield* svc.getClipMockupChaptersByIds([id]);
    yield* emitObject(archived);
  })
).pipe(Command.withDescription(detail(DELETE_HELP)));

export const clipMockupChapterCommand = Command.make(
  "clip-mockup-chapter"
).pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    addCmd,
    updateCmd,
    moveCmd,
    deleteCmd,
  ])
);
