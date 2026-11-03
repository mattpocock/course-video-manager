import { Args, Command, Options } from "@effect/cli";
import { Clock, Effect } from "effect";
import { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import {
  NEEDS_THE_SIDECAR_TO_CHANGE_THE_QUEUE,
  requireLocalMachine,
} from "@/cli/local-only";
import { parseError } from "@/cli/errors";
import { detail } from "@/cli/helpers";
import { draftIdArg, draftIdOption, optionalDraftId } from "../entity-id";
import { emitPostingQueue } from "./short-post";
import { MOVE_HELP, UNQUEUE_HELP } from "./short.help";

// ---------------------------------------------------------------------------
// short move
// ---------------------------------------------------------------------------

const topOption = Options.boolean("top").pipe(
  Options.withDescription("move it to the head of the Posting Queue")
);
const beforeOption = draftIdOption("before", "video").pipe(
  Options.withDescription("move it just before this Queued Short"),
  Options.optional
);
const afterOption = draftIdOption("after", "video").pipe(
  Options.withDescription("move it just after this Queued Short"),
  Options.optional
);

export const moveCmd = Command.make(
  "move",
  {
    top: topOption,
    before: beforeOption,
    after: afterOption,
    id: draftIdArg("video"),
  },
  ({ top, before, after, id }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine(
        "cvm short move",
        NEEDS_THE_SIDECAR_TO_CHANGE_THE_QUEUE
      );
      const videoId = yield* id;
      const beforeId = yield* optionalDraftId(before);
      const afterId = yield* optionalDraftId(after);
      const given = [top, beforeId, afterId].filter(
        (v) => v !== false && v !== undefined
      ).length;
      if (given !== 1) {
        return yield* parseError(
          "short move needs exactly one of --top / --before <id> / --after <id>",
          "video"
        );
      }
      yield* Effect.flatMap(PostingQueueOperationsService, (svc) =>
        svc.moveShort({
          videoId,
          to:
            beforeId !== undefined
              ? { kind: "before", videoId: beforeId }
              : afterId !== undefined
                ? { kind: "after", videoId: afterId }
                : { kind: "top" },
        })
      );
      yield* emitPostingQueue;
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

// ---------------------------------------------------------------------------
// short unqueue
// ---------------------------------------------------------------------------

export const unqueueCmd = Command.make(
  "unqueue",
  { ids: draftIdArg("video").pipe(Args.atLeast(1)) },
  ({ ids: refs }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine(
        "cvm short unqueue",
        NEEDS_THE_SIDECAR_TO_CHANGE_THE_QUEUE
      );
      const videoIds = yield* Effect.all(refs);
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.flatMap(PostingQueueOperationsService, (svc) =>
        svc.unqueueShorts({ videoIds, now })
      );
      yield* emitPostingQueue;
    })
).pipe(Command.withDescription(detail(UNQUEUE_HELP)));
