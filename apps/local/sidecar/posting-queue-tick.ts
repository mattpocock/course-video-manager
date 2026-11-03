import { Clock, Effect, Option, Schedule } from "effect";
import { formatLondon } from "@cvm/core/features/time/london-time";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import { findExportedVideo } from "@/services/finished-videos.server";
import { storageRootsConfig } from "@/services/storage-roots";
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
 * Until the Sidecar renders a Short at its slot (#2615), a Short with no
 * vertical export does not claim: it waits, saying why on its entry, where
 * `cvm short queue` shows it.
 */
export const postingQueueTick = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const queue = yield* PostingQueueSidecarService;
  yield* queue.settlePosted();
  const due = yield* queue.due(now);
  if (!due) return;

  const roots = yield* storageRootsConfig;
  const exported = yield* findExportedVideo(roots, `${due.videoId}.mp4`);
  if (Option.isNone(exported)) {
    yield* queue.noteWaiting({
      entryId: due.entryId,
      reason: `It waits for its vertical export: its Posting Slot at ${formatLondon(due.slot)} is due, but it has not been rendered. Render it with 'cvm short render ${due.videoId}'.`,
    });
    return;
  }

  const claimed = yield* queue.claim({ claim: due, now });
  if (claimed) {
    yield* Effect.logInfo("posting queue: claimed a Posting Slot", {
      entryId: due.entryId,
      videoId: due.videoId,
      slot: new Date(due.slot).toISOString(),
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
