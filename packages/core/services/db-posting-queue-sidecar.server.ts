import { and, eq, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { postingQueueEntries, videoPosts, videos } from "../db/schema.js";
import {
  SHORT_POSTING_JOB_KINDS,
  SHORT_POSTING_JOB_POLICY,
  type QueuedShortPostParams,
} from "../features/posting-queue/posting-jobs.js";
import {
  dueNow,
  SLOT_PATTERNS,
} from "../features/posting-queue/slot-schedule.js";
import { createEnqueueJobOperations } from "./db-job-enqueue.server.js";
import {
  selectScheduleRows,
  toScheduleEntry,
} from "./db-posting-queue-operations.server.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/** A Posting Slot that is due, and the Short that takes it. */
export type DueClaim = {
  readonly entryId: string;
  readonly videoId: string;
  readonly title: string;
  /** Epoch ms. */
  readonly slot: number;
};

/**
 * The Posting Queue as only the Sidecar uses it (ADR 0057): the tick that
 * settles and claims Posting Slots, and the posting Jobs that read the Short
 * they post. Never reached over HTTP: `cvm` and the app use
 * `PostingQueueOperationsService`.
 */
export const createPostingQueueSidecarOperations = (db: Database) => {
  /**
   * Mark Posted every Posting entry whose Short both channels have: a
   * `youtube-shorts` and a `buffer` Video Post, each posted, written since
   * the entry claimed its slot. It left the queue when the later one went out.
   */
  const settlePosted = Effect.fn("settlePosted")(function* () {
    const posting = yield* makeDbCall(() =>
      db
        .select()
        .from(postingQueueEntries)
        .where(eq(postingQueueEntries.state, "posting"))
    );
    for (const entry of posting) {
      const claimedAt = entry.claimedAt;
      if (!claimedAt) continue;
      const posts = yield* makeDbCall(() =>
        db
          .select({
            platform: videoPosts.platform,
            postedAt: videoPosts.postedAt,
          })
          .from(videoPosts)
          .where(
            and(
              eq(videoPosts.videoId, entry.videoId),
              isNotNull(videoPosts.postedAt),
              gte(videoPosts.createdAt, claimedAt)
            )
          )
      );
      const postedOn = (platform: string) =>
        posts
          .filter((p) => p.platform === platform)
          .map((p) => p.postedAt!.getTime());
      const times = SHORT_POSTING_JOB_KINDS.map(postedOn);
      if (times.some((t) => t.length === 0)) continue;
      const endedAt = new Date(Math.max(...times.map((t) => Math.min(...t))));
      yield* makeDbCall(() =>
        db
          .update(postingQueueEntries)
          .set({ state: "posted", endedAt })
          .where(
            and(
              eq(postingQueueEntries.id, entry.id),
              eq(postingQueueEntries.state, "posting")
            )
          )
      );
    }
  });

  const dueAt = (handle: Database, now: number) =>
    Effect.gen(function* () {
      const rows = yield* selectScheduleRows(handle, now);
      const due = dueNow({
        now,
        entries: rows.map(toScheduleEntry),
        patterns: SLOT_PATTERNS,
      });
      if (due.kind !== "claim") return null;
      const entry = rows.find((r) => r.id === due.entryId)!;
      return { entryId: entry.id, videoId: entry.videoId, slot: due.slot };
    });

  /** The Posting Slot due at `now` and the Short that takes it, or null. */
  const due = Effect.fn("due")(function* (now: number) {
    const claim = yield* dueAt(db, now);
    if (!claim) return null;
    const [video] = yield* makeDbCall(() =>
      db
        .select({ title: videos.title })
        .from(videos)
        .where(eq(videos.id, claim.videoId))
    );
    return { ...claim, title: video?.title ?? "" } satisfies DueClaim;
  });

  /**
   * Claim a due Posting Slot, in ONE transaction: the entry becomes Posting
   * with its slot, and one posting Job per channel is enqueued, each
   * carrying the entry id. A crash before the commit did nothing; after it,
   * the slot is claimed and no tick claims it again. The Slot Schedule is
   * asked again inside the transaction, under a lock every tick takes, so a
   * claim that is no longer due (another tick took it) claims nothing.
   * Answers whether it claimed.
   */
  const claim = Effect.fn("claim")(function* (input: {
    readonly claim: DueClaim;
    /** Epoch ms: the tick's clock. */
    readonly now: number;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* makeDbCall(() =>
          tx.execute(
            sql`select pg_advisory_xact_lock(hashtext('posting-queue-claim'))`
          )
        );
        const still = yield* dueAt(tx, input.now);
        if (
          !still ||
          still.entryId !== input.claim.entryId ||
          still.slot !== input.claim.slot
        ) {
          return false;
        }
        yield* makeDbCall(() =>
          tx
            .update(postingQueueEntries)
            .set({
              state: "posting",
              claimedSlot: new Date(input.claim.slot),
              claimedAt: new Date(input.now),
              lastFailureReason: null,
            })
            .where(eq(postingQueueEntries.id, input.claim.entryId))
        );
        const params: QueuedShortPostParams = {
          videoId: input.claim.videoId,
          postingQueueEntryId: input.claim.entryId,
        };
        const enqueue = createEnqueueJobOperations(tx).enqueueJob;
        for (const kind of SHORT_POSTING_JOB_KINDS) {
          yield* enqueue({
            id: null,
            kind,
            title: input.claim.title,
            lane: SHORT_POSTING_JOB_POLICY.lane,
            params,
            maxAttempts: SHORT_POSTING_JOB_POLICY.maxAttempts,
            dependsOn: null,
            subject: { type: "video", id: input.claim.videoId },
          }).pipe(
            // Only a caller-chosen Job id can be taken; these are fresh.
            Effect.catchTag(
              "JobIdTakenError",
              (e) => new UnknownDBServiceError({ cause: e })
            )
          );
        }
        return true;
      })
    );
  });

  /**
   * Say on a Queued entry why it did not take its due slot, for
   * `cvm short queue` to show. Cleared when it claims.
   */
  const noteWaiting = Effect.fn("noteWaiting")(function* (input: {
    readonly entryId: string;
    readonly reason: string;
  }) {
    yield* makeDbCall(() =>
      db
        .update(postingQueueEntries)
        .set({ lastFailureReason: input.reason })
        .where(
          and(
            eq(postingQueueEntries.id, input.entryId),
            eq(postingQueueEntries.state, "queued"),
            or(
              isNull(postingQueueEntries.lastFailureReason),
              ne(postingQueueEntries.lastFailureReason, input.reason)
            )
          )
        )
    );
  });

  /**
   * What a posting Job the Posting Queue enqueued posts: the Short's title
   * and description as the Video has them NOW, when the Job runs.
   */
  const shortToPost = Effect.fn("shortToPost")(function* (
    params: QueuedShortPostParams
  ) {
    const [row] = yield* makeDbCall(() =>
      db
        .select({ title: videos.title, description: videos.description })
        .from(postingQueueEntries)
        .innerJoin(videos, eq(videos.id, postingQueueEntries.videoId))
        .where(
          and(
            eq(postingQueueEntries.id, params.postingQueueEntryId),
            eq(postingQueueEntries.videoId, params.videoId)
          )
        )
    );
    if (!row) {
      return yield* new NotFoundError({
        type: "posting-queue-entry",
        params: { id: params.postingQueueEntryId },
        message: `Posting Queue entry not found for this Short: ${params.postingQueueEntryId}`,
      });
    }
    return {
      title: row.title.trim(),
      description: (row.description ?? "").trim(),
    };
  });

  return { settlePosted, due, claim, noteWaiting, shortToPost };
};

export class PostingQueueSidecarService extends Effect.Service<PostingQueueSidecarService>()(
  "PostingQueueSidecarService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createPostingQueueSidecarOperations(db);
    }),
  }
) {}
