import { Args, Command, Options } from "@effect/cli";
import { Clock, Effect } from "effect";
import {
  postingQueueView,
  withGoesOutAt,
} from "@cvm/core/features/posting-queue/goes-out-at";
import { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import { ShortPostRefusedError } from "@/services/db-service-errors";
import {
  NEEDS_THE_SIDECAR_TO_POST,
  requireLocalMachine,
} from "@/cli/local-only";
import { detail, emitNdjson, emitObject } from "@/cli/helpers";
import { draftIdArg } from "../entity-id";
import { POST_HELP, QUEUE_HELP } from "./short.help";

// ---------------------------------------------------------------------------
// short post
// ---------------------------------------------------------------------------

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDescription(
    "print each Short's verdict and when it would go out, and write nothing"
  )
);

const nowOption = Options.boolean("now").pipe(
  Options.withDescription(
    "Post Now: the Sidecar posts each Short at its next check, ahead of the slots, in the order given (a Short already Queued is marked, not refused)"
  )
);

export const postCmd = Command.make(
  "post",
  {
    dryRun: dryRunOption,
    now: nowOption,
    ids: draftIdArg("video").pipe(Args.atLeast(1)),
  },
  ({ dryRun, now: postNow, ids: refs }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm short post", NEEDS_THE_SIDECAR_TO_POST);
      const videoIds = yield* Effect.all(refs);
      const now = yield* Clock.currentTimeMillis;
      const verdicts = yield* Effect.flatMap(
        PostingQueueOperationsService,
        (svc) => svc.postShorts({ videoIds, dryRun, postNow, now })
      );
      yield* emitNdjson(verdicts.map(withGoesOutAt));

      // A dry run exits as the real run would: 3 if any Short is refused.
      const refusals = verdicts.flatMap((v) =>
        v.verdict === "refused"
          ? [{ videoId: v.videoId, reason: v.reason! }]
          : []
      );
      if (refusals.length > 0) {
        return yield* new ShortPostRefusedError({
          refusals,
          message: `Dry run: ${refusals.length} of ${verdicts.length} Shorts would be refused, so a real run would queue none of them`,
        });
      }
    })
).pipe(Command.withDescription(detail(POST_HELP)));

// ---------------------------------------------------------------------------
// short queue
// ---------------------------------------------------------------------------

/** Print the Posting Queue as it stands, the one object `cvm short queue` prints. */
export const emitPostingQueue = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const listing = yield* Effect.flatMap(PostingQueueOperationsService, (svc) =>
    svc.listPostingQueue(now)
  );
  yield* emitObject(postingQueueView(listing));
});

export const queueCmd = Command.make("queue", {}, () => emitPostingQueue).pipe(
  Command.withDescription(detail(QUEUE_HELP))
);
