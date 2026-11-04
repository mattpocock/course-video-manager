import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { postingQueueEntries, videos } from "../db/schema.js";
import { LIVE_POSTING_QUEUE_ENTRY_STATES } from "../features/posting-queue/slot-schedule.js";
import {
  NotFoundError,
  PostingQueueChangeRefusedError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { requireDraftVersionForPostingQueueEntry } from "./draft-guard.server.js";
import type { Database } from "./drizzle-service.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/** Where `cvm short move` puts a Queued Short. */
export type PostingQueueMove =
  | { readonly kind: "top" }
  | { readonly kind: "before"; readonly videoId: string }
  | { readonly kind: "after"; readonly videoId: string };

type Refusal = { readonly videoId: string; readonly reason: string };

const POSTING_REASON =
  "it is Posting: it has claimed its Posting Slot and is being posted";

/**
 * Taken inside every change, the same lock the Sidecar's claim takes, so a
 * move or an unqueue never interleaves with a claim of the same entry.
 */
const lockTheQueue = (tx: Database) =>
  makeDbCall(() =>
    tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('posting-queue-claim'))`
    )
  );

const refuse = (verb: string, refusals: ReadonlyArray<Refusal>) =>
  new PostingQueueChangeRefusedError({
    refusals,
    message: `Nothing was changed: ${refusals
      .map((r) => `${r.videoId} cannot be ${verb}, because ${r.reason}`)
      .join("; ")}`,
  });

const requireVideos = (db: Database, ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = yield* makeDbCall(() =>
      db
        .select({ id: videos.id })
        .from(videos)
        .where(inArray(videos.id, [...ids]))
    );
    const missing = ids.find((id) => !found.some((v) => v.id === id));
    if (missing !== undefined) {
      return yield* new NotFoundError({
        type: "video",
        params: { id: missing },
        message: `Video not found: ${missing}`,
      });
    }
  });

/** `cvm short move` and `cvm short unqueue`: changes to the Posting Queue. */
export const createPostingQueueChanges = (db: Database) => {
  const liveEntries = (tx: Database) =>
    makeDbCall(() =>
      tx
        .select()
        .from(postingQueueEntries)
        .where(
          inArray(postingQueueEntries.state, [
            ...LIVE_POSTING_QUEUE_ENTRY_STATES,
          ])
        )
        .orderBy(asc(postingQueueEntries.order))
    );

  /**
   * Give a Queued Short a new order rank: the head of the queue, or just
   * before or after another Queued Short. Only Queued Shorts move: one that
   * is Posting or Held has its slot already.
   */
  const moveShort = Effect.fn("moveShort")(function* (input: {
    readonly videoId: string;
    readonly to: PostingQueueMove;
  }) {
    const anchorId = input.to.kind === "top" ? null : input.to.videoId;
    yield* requireVideos(
      db,
      anchorId === null ? [input.videoId] : [input.videoId, anchorId]
    );
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* lockTheQueue(tx);
        const live = yield* liveEntries(tx);
        const queuedOf = (videoId: string, self: boolean): Refusal | null => {
          const entry = live.find((e) => e.videoId === videoId);
          const whose = self
            ? "it"
            : `the Short to move it next to (${videoId})`;
          if (!entry)
            return { videoId, reason: `${whose} is not in the Posting Queue` };
          if (entry.state === "posting") {
            return {
              videoId,
              reason: self
                ? POSTING_REASON
                : `${whose} is Posting: only Queued Shorts have an order`,
            };
          }
          if (entry.state === "held") {
            return {
              videoId,
              reason: `${whose} is Held: it has claimed its Posting Slot`,
            };
          }
          return null;
        };
        const refusals = [
          queuedOf(input.videoId, true),
          anchorId === null
            ? null
            : anchorId === input.videoId
              ? {
                  videoId: anchorId,
                  reason: "a Short cannot move next to itself",
                }
              : queuedOf(anchorId, false),
        ].filter((r): r is Refusal => r !== null);
        if (refusals.length > 0) return yield* refuse("moved", refusals);

        const target = live.find((e) => e.videoId === input.videoId)!;
        const others = live.filter(
          (e) => e.state === "queued" && e.id !== target.id
        );
        yield* requireDraftVersionForPostingQueueEntry(tx, target.id);
        const at = others.findIndex((e) => e.videoId === anchorId);
        const [below, above] =
          input.to.kind === "top"
            ? [null, others[0]?.order ?? null]
            : input.to.kind === "before"
              ? [others[at - 1]?.order ?? null, others[at]!.order]
              : [others[at]!.order, others[at + 1]?.order ?? null];
        yield* makeDbCall(() =>
          tx
            .update(postingQueueEntries)
            .set({ order: generateKeyBetween(below, above) })
            .where(eq(postingQueueEntries.id, target.id))
        );
      })
    );
  });

  /**
   * Take Shorts off the Posting Queue: a Queued or Held entry, or the Failed
   * ones still shown. A Short taken off can be posted again. If any Short is
   * refused (Posting, or not in the queue), nothing is taken off.
   */
  const unqueueShorts = Effect.fn("unqueueShorts")(function* (input: {
    readonly videoIds: ReadonlyArray<string>;
    /** Epoch ms: the caller's clock. */
    readonly now: number;
  }) {
    const ids = [...new Set(input.videoIds)];
    yield* requireVideos(db, ids);
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* lockTheQueue(tx);
        const live = yield* liveEntries(tx);
        const failed = yield* makeDbCall(() =>
          tx
            .select({
              id: postingQueueEntries.id,
              videoId: postingQueueEntries.videoId,
            })
            .from(postingQueueEntries)
            .where(
              and(
                inArray(postingQueueEntries.videoId, ids),
                eq(postingQueueEntries.state, "failed")
              )
            )
        );
        const refusals = ids.flatMap((videoId): Refusal[] => {
          const entry = live.find((e) => e.videoId === videoId);
          if (entry?.state === "posting") {
            return [{ videoId, reason: POSTING_REASON }];
          }
          if (!entry && !failed.some((f) => f.videoId === videoId)) {
            return [{ videoId, reason: "it is not in the Posting Queue" }];
          }
          return [];
        });
        if (refusals.length > 0) return yield* refuse("taken off", refusals);

        const leaving = live.filter((e) => ids.includes(e.videoId));
        for (const entry of [...leaving, ...failed]) {
          yield* requireDraftVersionForPostingQueueEntry(tx, entry.id);
        }
        if (leaving.length > 0) {
          yield* makeDbCall(() =>
            tx
              .update(postingQueueEntries)
              .set({ state: "removed", endedAt: new Date(input.now) })
              .where(
                inArray(
                  postingQueueEntries.id,
                  leaving.map((e) => e.id)
                )
              )
          );
        }
        // A Failed entry already ended: it keeps its endedAt.
        if (failed.length > 0) {
          yield* makeDbCall(() =>
            tx
              .update(postingQueueEntries)
              .set({ state: "removed" })
              .where(
                inArray(
                  postingQueueEntries.id,
                  failed.map((f) => f.id)
                )
              )
          );
        }
      })
    );
  });

  return { moveShort, unqueueShorts };
};
