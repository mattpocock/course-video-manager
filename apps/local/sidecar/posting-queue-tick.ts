import { Clock, Effect, Schedule } from "effect";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import { isShortExportStale } from "@/services/short-export-hash";
import { isMainCheckout } from "../live-desk/live-desk";

/**
 * THE POSTING QUEUE TICK (ADR 0057): the Sidecar's own loop, every
 * `postingQueueTickMs`, that posts the head of the Posting Queue at its
 * Posting Slot.
 *
 * Each tick reads the time from Effect's `Clock`, marks Posted every Posting
 * entry both channels now have, then asks the Slot Schedule what is due. A
 * due slot is claimed in one transaction that also enqueues the `youtube-shorts`
 * and `buffer` posting Jobs; the lanes run them. The Slot Schedule makes no
 * claim while another is still Posting, so missed slots go out one at a time.
 *
 * A Short whose vertical export is stale (no export, no Short Export Hash
 * beside it, or a different one) is rendered just in time: the claim also
 * enqueues a `render-vertical` Job, and both posting Jobs wait on it. A
 * render that fails for good posts nothing; its reason is written on the
 * entry, where `cvm short queue` shows it.
 */
export const postingQueueTick = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const queue = yield* PostingQueueSidecarService;
  yield* queue.settlePosted();
  yield* queue.noteRenderFailures();
  const due = yield* queue.due(now);
  if (!due) return;

  const render = yield* isShortExportStale(due.videoId);
  const claimed = yield* queue.claim({ claim: due, now, render });
  if (claimed) {
    yield* Effect.logInfo("posting queue: claimed a Posting Slot", {
      entryId: due.entryId,
      videoId: due.videoId,
      slot: new Date(due.slot).toISOString(),
      render,
    });
  }
});

/**
 * The tick a Sidecar running in `checkout` runs: the real one only in Matt's
 * MAIN CHECKOUT, detected the way the live desk detects it. Every other
 * checkout (a worktree, a verify-cvm clone) gets a tick that posts nothing,
 * so only one Sidecar ever posts the queue.
 */
export const postingQueueTickIn = (
  checkout: string,
  o: { scratchRoots?: readonly string[] } = {}
) => (isMainCheckout(checkout, o) ? postingQueueTick : Effect.void);

/**
 * The Sidecar's loop: `tick` at start and then every `everyMs`. A failure
 * is logged and never stops the Sidecar; after each tick the lanes look for
 * the posting Jobs a claim enqueued.
 */
export const repeatTick = <R>(
  tick: Effect.Effect<void, unknown, R>,
  everyMs: number,
  nudge: Effect.Effect<void>
) =>
  Effect.repeat(
    tick.pipe(
      Effect.catchAllCause((cause) =>
        Effect.logError("sidecar: the Posting Queue tick failed", cause)
      ),
      Effect.zipRight(nudge)
    ),
    Schedule.spaced(everyMs)
  );
