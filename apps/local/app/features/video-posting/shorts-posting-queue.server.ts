import { Clock, Effect } from "effect";
import {
  postingQueueView,
  withGoesOutAt,
} from "@cvm/core/features/posting-queue/goes-out-at";
import { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import type { ShortPostVerdict } from "@/services/db-posting-queue-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";

/**
 * The Shorts page modal's side of the Posting Queue. It adds a Short through
 * `postShorts`, the one function `cvm short post` calls, so the modal and the
 * CLI cannot queue a Short differently, refuse it for different reasons or
 * disagree on when it goes out. It never enqueues a posting Job: the Sidecar's
 * Posting Queue tick does that at the Short's Posting Slot.
 */

/** A verdict as the modal shows it: with its UK time beside the slot. */
export type ShortQueueVerdict = ShortPostVerdict & {
  readonly goesOutAt: string | null;
};

const verdictOf = (videoId: string, dryRun: boolean) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const queueOps = yield* PostingQueueOperationsService;
    const [verdict] = yield* queueOps.postShorts({
      videoIds: [videoId],
      dryRun,
      now,
    });
    return withGoesOutAt(verdict!);
  });

/**
 * What the modal opens on: the Short's description as the Video has it, and
 * the `--dry-run` verdict: when it would go out, or why it would be refused.
 */
export const previewShortPost = Effect.fn("previewShortPost")(function* (
  videoId: string
) {
  const videoOps = yield* VideoOperationsService;
  const video = yield* videoOps.getVideoRowById(videoId);
  const verdict: ShortQueueVerdict = yield* verdictOf(videoId, true);
  return { description: video.description ?? "", verdict };
});

/** The modal's description, saved on the Video, where the CLI reads it. */
export const saveShortDescription = Effect.fn("saveShortDescription")(
  function* (input: {
    readonly videoId: string;
    readonly description: string;
  }) {
    const videoOps = yield* VideoOperationsService;
    yield* videoOps.updateVideoDescription({
      videoId: input.videoId,
      description: input.description.trim() || null,
    });
  }
);

/**
 * Add to Posting Queue: save the title and description the modal shows on
 * the Video (a rename on blur may still be in flight), then queue the Short
 * as `cvm short post` would. A refusal comes back as a refused verdict.
 */
export const addShortToPostingQueue = Effect.fn("addShortToPostingQueue")(
  function* (input: {
    readonly videoId: string;
    readonly title: string;
    readonly description: string;
  }) {
    const videoOps = yield* VideoOperationsService;
    const video = yield* videoOps.getVideoRowById(input.videoId);
    const title = input.title.trim();
    if (title && title !== video.title) {
      yield* videoOps.updateVideoTitle({ videoId: input.videoId, title });
    }
    yield* saveShortDescription(input);
    const verdict: ShortQueueVerdict = yield* verdictOf(
      input.videoId,
      false
    ).pipe(
      Effect.catchTag("ShortPostRefusedError", (error) =>
        Effect.succeed({
          videoId: input.videoId,
          title: title || video.title,
          verdict: "refused" as const,
          reason: error.refusals[0]?.reason ?? error.message,
          slot: null,
          goesOutAt: null,
        })
      )
    );
    return verdict;
  }
);

/** The Queue panel: the Posting Queue exactly as `cvm short queue` prints it. */
export const loadPostingQueuePanel = Effect.fn("loadPostingQueuePanel")(
  function* () {
    const now = yield* Clock.currentTimeMillis;
    const queueOps = yield* PostingQueueOperationsService;
    return postingQueueView(yield* queueOps.listPostingQueue(now));
  }
);
