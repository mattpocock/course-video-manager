import { and, asc, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { postingQueueEntries, videoPosts, videos } from "../db/schema.js";
import {
  LIVE_POSTING_QUEUE_ENTRY_STATES,
  projectPostingQueue,
  SLOT_PATTERNS,
  SLOT_SCHEDULE_HISTORY_DAYS,
  type PostingQueueEntryState,
  type SlotScheduleEntry,
} from "../features/posting-queue/slot-schedule.js";
import { londonDateOf } from "../features/time/london-time.js";
import { isDefaultShortTitle } from "../features/videos/short-title.js";
import {
  NotFoundError,
  ShortPostRefusedError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { DrizzleService, type Database } from "./drizzle-service.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/** One Short's verdict from `postShorts`. */
export type ShortPostVerdict = {
  readonly videoId: string;
  readonly title: string;
  readonly verdict: "queued" | "refused";
  /** Why it was refused; null when it is (or would be) queued. */
  readonly reason: string | null;
  /** When it would go out, as an ISO instant; null when refused. */
  readonly slot: string | null;
};

/** One row of `cvm short queue`. */
export type PostingQueueRow = {
  readonly entryId: string;
  readonly videoId: string;
  readonly title: string;
  readonly state: PostingQueueEntryState;
  /**
   * Queued: when it is expected to go out. Posting or Held: the slot it
   * claimed. Failed: the slot it used. ISO instant.
   */
  readonly slot: string | null;
  readonly lastFailureReason: string | null;
};

export type PostingQueueListing = {
  readonly entries: ReadonlyArray<PostingQueueRow>;
  /** How many UK days the Queued Shorts' projected slots fall on. */
  readonly days: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const toScheduleEntry = (
  row: typeof postingQueueEntries.$inferSelect
): SlotScheduleEntry => ({
  id: row.id,
  queuedAt: row.queuedAt.getTime(),
  order: row.order,
  state: row.state,
  claimedSlot: row.claimedSlot?.getTime() ?? null,
  endedAt: row.endedAt?.getTime() ?? null,
});

/**
 * Every entry the Slot Schedule needs at `now`: the live ones, and those that
 * ended recently enough for their day's queue length or claim to matter
 * (catch-up looks back at most to last Friday).
 */
export const selectScheduleRows = (db: Database, now: number) =>
  makeDbCall(() =>
    db
      .select()
      .from(postingQueueEntries)
      .where(
        or(
          isNull(postingQueueEntries.endedAt),
          gt(
            postingQueueEntries.endedAt,
            new Date(now - (SLOT_SCHEDULE_HISTORY_DAYS + 1) * DAY_MS)
          )
        )
      )
      .orderBy(asc(postingQueueEntries.order))
  );

const isLive = (state: PostingQueueEntryState) =>
  (LIVE_POSTING_QUEUE_ENTRY_STATES as ReadonlyArray<string>).includes(state);

export const createPostingQueueOperations = (db: Database) => {
  const scheduleRows = (now: number) => selectScheduleRows(db, now);

  /**
   * Add Shorts to the Posting Queue, oldest first in the order given. Every
   * Short is checked first; if any is refused, nothing is queued and the
   * call fails with ShortPostRefusedError. With `dryRun` nothing is written
   * and every verdict comes back, refusals included.
   */
  const postShorts = Effect.fn("postShorts")(function* (input: {
    readonly videoIds: ReadonlyArray<string>;
    readonly dryRun: boolean;
    /** Epoch ms: the caller's clock. */
    readonly now: number;
  }) {
    const ids = [...new Set(input.videoIds)];
    const found = yield* makeDbCall(() =>
      db
        .select({
          id: videos.id,
          title: videos.title,
          format: videos.format,
          description: videos.description,
        })
        .from(videos)
        .where(inArray(videos.id, ids))
    );
    const missing = ids.find((id) => !found.some((v) => v.id === id));
    if (missing !== undefined) {
      return yield* new NotFoundError({
        type: "video",
        params: { id: missing },
        message: `Video not found: ${missing}`,
      });
    }

    const rows = yield* scheduleRows(input.now);
    const live = yield* makeDbCall(() =>
      db
        .select({
          videoId: postingQueueEntries.videoId,
          state: postingQueueEntries.state,
        })
        .from(postingQueueEntries)
        .where(
          and(
            inArray(postingQueueEntries.videoId, ids),
            inArray(postingQueueEntries.state, [
              ...LIVE_POSTING_QUEUE_ENTRY_STATES,
            ])
          )
        )
    );
    const postedRows = yield* makeDbCall(() =>
      db
        .select({ videoId: videoPosts.videoId, platform: videoPosts.platform })
        .from(videoPosts)
        .where(
          and(
            inArray(videoPosts.videoId, ids),
            // A Video Post with no postedAt is queued, not posted.
            isNotNull(videoPosts.postedAt)
          )
        )
    );

    const refusalOf = (video: (typeof found)[number]): string | null => {
      if (video.format !== "short") {
        return "it is a Landscape Video: only a Short goes through the Posting Queue";
      }
      if (isDefaultShortTitle(video.title.trim())) {
        return `it still has its default title ("${video.title}"): rename it first with 'cvm video update --name'`;
      }
      if (!video.description?.trim()) {
        return "it has no description: set one first with 'cvm video update --description'";
      }
      const entry = live.find((e) => e.videoId === video.id);
      if (entry) {
        return `it is already in the Posting Queue (${entry.state})`;
      }
      const platforms = new Set(
        postedRows.filter((p) => p.videoId === video.id).map((p) => p.platform)
      );
      if (platforms.has("youtube-shorts") && platforms.has("buffer")) {
        return "it is already Posted on both YouTube and TikTok";
      }
      return null;
    };

    const checked = ids.map((id) => {
      const video = found.find((v) => v.id === id)!;
      return { video, reason: refusalOf(video) };
    });
    const accepted = checked.filter((c) => c.reason === null);

    const lastOrder = rows
      .filter((r) => isLive(r.state))
      .reduce<string | null>(
        (max, r) => (max === null || r.order > max ? r.order : max),
        null
      );
    const orders = generateNKeysBetween(lastOrder, null, accepted.length);
    const newEntries = accepted.map((c, i) => ({
      id: crypto.randomUUID(),
      videoId: c.video.id,
      order: orders[i]!,
    }));

    const projection = projectPostingQueue({
      now: input.now,
      entries: [
        ...rows.map(toScheduleEntry),
        ...newEntries.map((e): SlotScheduleEntry => ({
          id: e.id,
          queuedAt: input.now,
          order: e.order,
          state: "queued",
          claimedSlot: null,
          endedAt: null,
        })),
      ],
      patterns: SLOT_PATTERNS,
    });

    const verdicts: ShortPostVerdict[] = checked.map(({ video, reason }) => {
      const entry = newEntries.find((e) => e.videoId === video.id);
      const slot = entry
        ? projection.find((p) => p.entryId === entry.id)?.slot
        : undefined;
      return {
        videoId: video.id,
        title: video.title,
        verdict: reason === null ? "queued" : "refused",
        reason,
        slot: slot === undefined ? null : new Date(slot).toISOString(),
      };
    });

    if (input.dryRun) return verdicts;

    const refusals = checked.flatMap(({ video, reason }) =>
      reason === null ? [] : [{ videoId: video.id, reason }]
    );
    if (refusals.length > 0) {
      return yield* new ShortPostRefusedError({
        refusals,
        message: `Nothing was queued: ${refusals
          .map((r) => `${r.videoId} is refused, because ${r.reason}`)
          .join("; ")}`,
      });
    }

    if (newEntries.length > 0) {
      yield* makeDbCall(() =>
        db.insert(postingQueueEntries).values(
          newEntries.map((e) => ({
            ...e,
            queuedAt: new Date(input.now),
            state: "queued" as const,
          }))
        )
      );
    }
    return verdicts;
  });

  /**
   * The Posting Queue as `cvm short queue` and the Queue panel show it: the
   * live entries in order, each with when it goes out, then the Failed ones
   * still within the schedule's history.
   */
  const listPostingQueue = Effect.fn("listPostingQueue")(function* (
    /** Epoch ms: the caller's clock. */
    now: number
  ) {
    const rows = yield* scheduleRows(now);
    const titles = yield* makeDbCall(() =>
      rows.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: videos.id, title: videos.title })
            .from(videos)
            .where(
              inArray(
                videos.id,
                rows.map((r) => r.videoId)
              )
            )
    );
    const projection = projectPostingQueue({
      now,
      entries: rows.map(toScheduleEntry),
      patterns: SLOT_PATTERNS,
    });
    const titleOf = (videoId: string) =>
      titles.find((t) => t.id === videoId)?.title ?? "";

    const row = (
      r: (typeof rows)[number],
      slot: number | null
    ): PostingQueueRow => ({
      entryId: r.id,
      videoId: r.videoId,
      title: titleOf(r.videoId),
      state: r.state,
      slot: slot === null ? null : new Date(slot).toISOString(),
      lastFailureReason: r.lastFailureReason,
    });

    // In flight first (they hold today's earlier slots), then the
    // projection's order, then what failed.
    const inFlight = rows
      .filter((r) => r.state === "posting" || r.state === "held")
      .sort(
        (a, b) =>
          (a.claimedSlot?.getTime() ?? 0) - (b.claimedSlot?.getTime() ?? 0)
      )
      .map((r) => row(r, r.claimedSlot?.getTime() ?? null));
    const queued = projection.map((p) =>
      row(
        rows.find((r) => r.id === p.entryId)!,
        p.slot
      )
    );
    const failed = rows
      .filter((r) => r.state === "failed")
      .map((r) => row(r, r.claimedSlot?.getTime() ?? null));

    const listing: PostingQueueListing = {
      entries: [...inFlight, ...queued, ...failed],
      days: new Set(projection.map((p) => londonDateOf(p.slot))).size,
    };
    return listing;
  });

  return { postShorts, listPostingQueue };
};

export class PostingQueueOperationsService extends Effect.Service<PostingQueueOperationsService>()(
  "PostingQueueOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createPostingQueueOperations(db);
    }),
  }
) {}
