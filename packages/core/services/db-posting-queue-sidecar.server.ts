import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { jobs, postingQueueEntries, videoPosts, videos } from "../db/schema.js";
import {
  SHORT_POSTING_JOB_KINDS,
  SHORT_POSTING_JOB_POLICY,
  SHORT_RENDER_JOB,
  type QueuedShortPostParams,
  type ShortPostingJobKind,
  type ShortRenderParams,
} from "../features/posting-queue/posting-jobs.js";
import {
  CHANNEL_NAME,
  messageOf,
  decideChannelFailures,
  type ChannelFailure,
  type ChannelOutcome,
  type EntryFailures,
} from "../features/posting-queue/channel-failures.js";
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
 * A posting Job whose Short is not to be posted any more: it left the
 * Posting Queue (taken off, Failed, Posted), or this channel already went
 * out since the slot was claimed. It posts nothing.
 */
export class ShortNotToPostError extends Data.TaggedError(
  "ShortNotToPostError"
)<{ readonly message: string }> {}

/**
 * Mark a channel posted that its post check found: the newest unposted
 * Video Post since the claim, or a new one when the run wrote none.
 */
const recordPosted = (
  tx: Database,
  input: { videoId: string; platform: string; claimedAt: Date; now: number }
) =>
  Effect.gen(function* () {
    const [row] = yield* makeDbCall(() =>
      tx
        .select({ id: videoPosts.id })
        .from(videoPosts)
        .where(
          and(
            eq(videoPosts.videoId, input.videoId),
            eq(videoPosts.platform, input.platform),
            gte(videoPosts.createdAt, input.claimedAt)
          )
        )
        .orderBy(desc(videoPosts.createdAt))
        .limit(1)
    );
    const postedAt = new Date(input.now);
    yield* makeDbCall(() =>
      row
        ? tx
            .update(videoPosts)
            .set({ postedAt })
            .where(eq(videoPosts.id, row.id))
        : tx.insert(videoPosts).values({
            videoId: input.videoId,
            platform: input.platform,
            postedAt,
          })
    );
  });

/** Enqueue a fresh Job in `tx`; only a caller-chosen Job id can be taken. */
const enqueueIn =
  (tx: Database) =>
  (
    job: Parameters<
      ReturnType<typeof createEnqueueJobOperations>["enqueueJob"]
    >[0]
  ) =>
    createEnqueueJobOperations(tx)
      .enqueueJob(job)
      .pipe(
        Effect.catchTag(
          "JobIdTakenError",
          (e) => new UnknownDBServiceError({ cause: e })
        )
      );

/**
 * Enqueue a Short's posting Jobs for `kinds`, each carrying its entry id,
 * after a `render-vertical` they all wait on when `render` (the export is
 * stale).
 */
const enqueueShortPosts = (
  tx: Database,
  input: {
    videoId: string;
    entryId: string;
    title: string;
    kinds: ReadonlyArray<ShortPostingJobKind>;
    render: boolean;
  }
) =>
  Effect.gen(function* () {
    const enqueue = enqueueIn(tx);
    const subject = { type: "video", id: input.videoId };
    const render = input.render
      ? yield* enqueue({
          id: null,
          kind: SHORT_RENDER_JOB.kind,
          title: input.title,
          lane: SHORT_RENDER_JOB.lane,
          params: { videoId: input.videoId } satisfies ShortRenderParams,
          maxAttempts: SHORT_RENDER_JOB.maxAttempts,
          dependsOn: null,
          subject,
        })
      : undefined;
    for (const kind of input.kinds) {
      yield* enqueue({
        id: null,
        kind,
        title: input.title,
        lane: SHORT_POSTING_JOB_POLICY.lane,
        params: {
          videoId: input.videoId,
          postingQueueEntryId: input.entryId,
        } satisfies QueuedShortPostParams,
        maxAttempts: SHORT_POSTING_JOB_POLICY.maxAttempts,
        dependsOn: render?.id ?? null,
        subject,
      });
    }
  });

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
   * A Held entry too: Matt's Job Retry may have posted its last channel.
   */
  const settlePosted = Effect.fn("settlePosted")(function* () {
    const posting = yield* makeDbCall(() =>
      db
        .select()
        .from(postingQueueEntries)
        .where(inArray(postingQueueEntries.state, ["posting", "held"]))
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
              inArray(postingQueueEntries.state, ["posting", "held"])
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
   * A Short whose vertical export is stale (`render`) also gets a
   * `render-vertical` Job in the same transaction, and both posting Jobs
   * wait on it. Answers whether it claimed.
   */
  const claim = Effect.fn("claim")(function* (input: {
    readonly claim: DueClaim;
    /** Epoch ms: the tick's clock. */
    readonly now: number;
    /** Whether the Short's vertical export is stale, so it renders first. */
    readonly render: boolean;
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
        yield* enqueueShortPosts(tx, {
          videoId: input.claim.videoId,
          entryId: input.claim.entryId,
          title: input.claim.title,
          kinds: SHORT_POSTING_JOB_KINDS,
          render: input.render,
        });
        return true;
      })
    );
  });

  const latestPostingJobs = (handle: Database, entryId: string) =>
    Effect.gen(function* () {
      const rows = yield* makeDbCall(() =>
        handle
          .select()
          .from(jobs)
          .where(
            and(
              sql`${jobs.params}->>'postingQueueEntryId' = ${entryId}`,
              inArray(jobs.kind, [...SHORT_POSTING_JOB_KINDS])
            )
          )
          .orderBy(asc(jobs.createdAt))
      );
      return new Map(rows.map((j) => [j.kind as ShortPostingJobKind, j]));
    });

  /**
   * The channels with a posted Video Post since the entry claimed its slot:
   * since its claim, by the tick's clock and by the database's (its posting
   * Jobs were written in the claim's transaction).
   */
  const postedChannels = (
    handle: Database,
    entry: { id: string; videoId: string; claimedAt: Date }
  ) =>
    Effect.gen(function* () {
      const [first] = yield* makeDbCall(() =>
        handle
          .select({ createdAt: jobs.createdAt })
          .from(jobs)
          .where(sql`${jobs.params}->>'postingQueueEntryId' = ${entry.id}`)
          .orderBy(asc(jobs.createdAt))
          .limit(1)
      );
      const since =
        first && first.createdAt > entry.claimedAt
          ? first.createdAt
          : entry.claimedAt;
      const rows = yield* makeDbCall(() =>
        handle
          .select({ platform: videoPosts.platform })
          .from(videoPosts)
          .where(
            and(
              eq(videoPosts.videoId, entry.videoId),
              isNotNull(videoPosts.postedAt),
              gte(videoPosts.createdAt, since)
            )
          )
      );
      return new Set(rows.map((r) => r.platform));
    });

  /**
   * The channels of each Posting or Held entry whose latest posting Job
   * ended failed or interrupted and that have not gone out since the claim
   * (#2618): what the tick looks at. A Job that never ran because its
   * `render-vertical` failed for good carries the render's reason, and
   * needs no post check: nothing was posted.
   */
  const channelFailures = Effect.fn("channelFailures")(function* () {
    const entries = yield* makeDbCall(() =>
      db
        .select()
        .from(postingQueueEntries)
        .where(inArray(postingQueueEntries.state, ["posting", "held"]))
    );
    const out: EntryFailures[] = [];
    for (const entry of entries) {
      const claimedAt = entry.claimedAt;
      if (!claimedAt) continue;
      const latest = yield* latestPostingJobs(db, entry.id);
      const posted = yield* postedChannels(db, {
        id: entry.id,
        videoId: entry.videoId,
        claimedAt,
      });
      const failures: ChannelFailure[] = [];
      for (const kind of SHORT_POSTING_JOB_KINDS) {
        const job = latest.get(kind);
        if (!job || posted.has(kind)) continue;
        if (job.status !== "failed" && job.status !== "interrupted") continue;
        const [render] = job.dependsOn
          ? yield* makeDbCall(() =>
              db
                .select({ status: jobs.status, error: jobs.error })
                .from(jobs)
                .where(eq(jobs.id, job.dependsOn!))
            )
          : [];
        failures.push({
          kind,
          job,
          renderFailure:
            render && render.status === "failed"
              ? `Its render failed: ${messageOf(render.error)}`
              : null,
        });
      }
      if (failures.length > 0) {
        out.push({ entryId: entry.id, videoId: entry.videoId, failures });
      }
    }
    return out;
  });

  /**
   * Act on what the post checks said about an entry's failed channels, in
   * ONE transaction under the claim's lock (#2618, ADR 0057):
   * - `posted`: the channel's Video Post is recorded as posted; nothing new;
   * - `unknown`: the entry is Held, nothing retried, with the check's words;
   * - `not-posted`: one more failure on that channel. The third marks the
   *   entry Failed (its slot stays used); otherwise a NEW posting Job for
   *   that channel only, after a fresh `render-vertical` if `render`.
   * A channel whose latest Job is no longer the one checked, or that has a
   * posted Video Post since the claim, is left alone: no Job is re-run and
   * no channel that went out is enqueued again.
   */
  const settleChannelFailures = Effect.fn("settleChannelFailures")(
    function* (input: {
      readonly entryId: string;
      readonly outcomes: ReadonlyArray<ChannelOutcome>;
      /** Epoch ms: the tick's clock. */
      readonly now: number;
      /** Whether the Short's vertical export is stale, so a retry renders. */
      readonly render: boolean;
    }) {
      return yield* withDbTransaction(db, (tx) =>
        Effect.gen(function* () {
          yield* makeDbCall(() =>
            tx.execute(
              sql`select pg_advisory_xact_lock(hashtext('posting-queue-claim'))`
            )
          );
          const [entry] = yield* makeDbCall(() =>
            tx
              .select()
              .from(postingQueueEntries)
              .where(eq(postingQueueEntries.id, input.entryId))
          );
          if (
            !entry?.claimedAt ||
            (entry.state !== "posting" && entry.state !== "held")
          ) {
            return;
          }
          const claimedAt = entry.claimedAt;
          const latest = yield* latestPostingJobs(tx, entry.id);
          const posted = yield* postedChannels(tx, {
            id: entry.id,
            videoId: entry.videoId,
            claimedAt,
          });
          const decided = decideChannelFailures({
            entry,
            outcomes: input.outcomes,
            latest,
            posted,
          });
          for (const kind of decided.posted) {
            yield* recordPosted(tx, {
              videoId: entry.videoId,
              platform: kind,
              claimedAt,
              now: input.now,
            });
          }
          const failed = decided.state === "failed";
          yield* makeDbCall(() =>
            tx
              .update(postingQueueEntries)
              .set({
                state: decided.state,
                youtubeFailures: decided.failures["youtube-shorts"],
                tiktokFailures: decided.failures.buffer,
                lastFailureReason: decided.reason ?? entry.lastFailureReason,
                ...(failed ? { endedAt: new Date(input.now) } : {}),
              })
              .where(eq(postingQueueEntries.id, entry.id))
          );
          if (failed || decided.retry.length === 0) return;
          yield* enqueueShortPosts(tx, {
            videoId: entry.videoId,
            entryId: entry.id,
            title: decided.retry[0]!.title,
            kinds: decided.retry.map((r) => r.kind),
            render: input.render,
          });
        })
      );
    }
  );

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

  /**
   * Refuse a posting Job whose Short is not to be posted any more (#2618):
   * its entry left the Posting Queue (taken off, Failed or Posted), or
   * `kind`'s channel already went out since the claim. So an old Job that
   * Matt retries never posts a Short he took off, or a channel twice.
   */
  const assertStillToPost = Effect.fn("assertStillToPost")(function* (
    params: QueuedShortPostParams,
    kind: ShortPostingJobKind
  ) {
    const [entry] = yield* makeDbCall(() =>
      db
        .select()
        .from(postingQueueEntries)
        .where(eq(postingQueueEntries.id, params.postingQueueEntryId))
    );
    if (
      !entry?.claimedAt ||
      (entry.state !== "posting" && entry.state !== "held")
    ) {
      return yield* new ShortNotToPostError({
        message: `This Short is no longer being posted from the Posting Queue (it is ${entry?.state ?? "gone"}), so nothing was posted.`,
      });
    }
    const posted = yield* postedChannels(db, {
      id: entry.id,
      videoId: entry.videoId,
      claimedAt: entry.claimedAt,
    });
    if (posted.has(kind)) {
      return yield* new ShortNotToPostError({
        message: `${CHANNEL_NAME[kind]} already has this Short since its Posting Slot, so nothing was posted.`,
      });
    }
  });

  return {
    settlePosted,
    due,
    claim,
    channelFailures,
    settleChannelFailures,
    assertStillToPost,
    shortToPost,
  };
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
