import {
  addLondonDays,
  londonDateOf,
  londonInstant,
  londonMidnight,
  londonWeekday,
  type LondonDate,
} from "../time/london-time.js";

/**
 * The Slot Schedule: the rule that turns the Posting Queue's length at 00:00
 * UK time, and the date, into a UK day's Posting Slots (ADR 0057).
 *
 * Pure: it is GIVEN `now`, the entries and the patterns, and reads no clock
 * and no database. It answers two questions from the same rules, so the
 * Sidecar's tick, `cvm short queue`, `cvm short post --dry-run` and the Queue
 * panel cannot disagree: what is due now ({@link dueNow}), and when each
 * Queued Short goes out ({@link projectPostingQueue}).
 */

/**
 * Where a Posting Queue entry stands. Queued, Posting and Held are LIVE (at
 * most one live entry per Short); Posted, Failed and removed have left the
 * queue, at `endedAt`.
 */
export const POSTING_QUEUE_ENTRY_STATES = [
  "queued",
  "posting",
  "posted",
  "held",
  "failed",
  "removed",
] as const;

export type PostingQueueEntryState =
  (typeof POSTING_QUEUE_ENTRY_STATES)[number];

export const LIVE_POSTING_QUEUE_ENTRY_STATES = [
  "queued",
  "posting",
  "held",
] as const satisfies ReadonlyArray<PostingQueueEntryState>;

/** One Posting Queue entry, as the Slot Schedule reads it. Times in epoch ms. */
export type SlotScheduleEntry = {
  readonly id: string;
  readonly queuedAt: number;
  /** Fractional Index: oldest first unless moved. */
  readonly order: string;
  readonly state: PostingQueueEntryState;
  /** The Posting Slot it claimed, once it is Posting. */
  readonly claimedSlot: number | null;
  /** When it left the queue: Posted, Failed or removed. */
  readonly endedAt: number | null;
  /**
   * When a Queued entry was asked to Post Now (`cvm short post --now`); null
   * otherwise. It goes out at the next check, ahead of the slots.
   */
  readonly postNowAt: number | null;
};

/** How many Posting Slots a UK day has. */
type SlotCount = 1 | 2 | 3;

/** UK wall-clock slot times for a day of 1, 2 and 3 Posting Slots. */
export type SlotPatterns = Readonly<Record<1 | 2 | 3, ReadonlyArray<string>>>;

/** The one place the slot times are set. */
export const SLOT_PATTERNS: SlotPatterns = {
  1: ["13:00"],
  2: ["09:00", "18:00"],
  3: ["09:00", "13:00", "18:00"],
};

/** More than this many queued at 00:00 gives a weekday 2 slots… */
const TWO_A_DAY_ABOVE = 14;
/** …and more than this, 3. */
const THREE_A_DAY_ABOVE = 21;

/**
 * How far back history can matter: only today's 00:00 and today's claims,
 * so one day (a UK day can be 25 hours long) is enough.
 */
export const SLOT_SCHEDULE_HISTORY_DAYS = 1;

export type SlotScheduleInput = {
  readonly now: number;
  readonly entries: ReadonlyArray<SlotScheduleEntry>;
  readonly patterns: SlotPatterns;
};

export type DueNow =
  | {
      readonly kind: "claim";
      readonly entryId: string;
      readonly slot: number;
    }
  | {
      readonly kind: "nothing";
      /** When the next Short is expected to go out; null for an empty queue. */
      readonly nextSlot: number | null;
    };

export type ProjectedPost = {
  readonly entryId: string;
  /** When it goes out; `now` for a missed slot taken at the next check. */
  readonly slot: number;
};

const byOrder = (a: SlotScheduleEntry, b: SlotScheduleEntry) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : 0;

/** The Queued entries asked to Post Now, in the order they were asked. */
const postNowQueue = (entries: ReadonlyArray<SlotScheduleEntry>) =>
  entries
    .filter((e) => e.state === "queued" && e.postNowAt !== null)
    .sort((a, b) => a.postNowAt! - b.postNowAt! || byOrder(a, b));

const isWeekend = (date: LondonDate) => {
  const day = londonWeekday(date);
  return day === 0 || day === 6;
};

/**
 * The walk both questions share. Today is read from history; days after
 * today are simulated: each Posting Slot takes the head of the queue, a
 * Posting entry is taken to settle, and a Held one stays.
 */
const walk = ({ now, entries, patterns }: SlotScheduleInput) => {
  const today = londonDateOf(now);
  const todayStart = londonMidnight(today);

  /** History: how many entries were in the queue at `ms`. */
  const liveAt = (ms: number) =>
    entries.filter(
      (e) => e.queuedAt < ms && (e.endedAt === null || e.endedAt > ms)
    ).length;

  const postNow = postNowQueue(entries);
  /** Queued entries that wait for a Posting Slot, in queue order. */
  const queued = entries
    .filter((e) => e.state === "queued" && e.postNowAt === null)
    .sort(byOrder);
  const held = entries.filter((e) => e.state === "held").length;
  /** Queued entries the walk has not given a slot yet, in queue order. */
  const remaining = [...queued];

  const queueLengthAt = (date: LondonDate) =>
    londonMidnight(date) <= todayStart
      ? liveAt(londonMidnight(date))
      : held + remaining.length;

  /**
   * The day's count, from its queue length at 00:00. An empty queue still
   * gives the day its 13:00 slot, so a Short queued onto it that morning goes
   * out that day. A missed day adds nothing to the next: there is no
   * catch-up.
   */
  const slotCount = (date: LondonDate): SlotCount => {
    const length = queueLengthAt(date);
    if (isWeekend(date)) return 1;
    return length > THREE_A_DAY_ABOVE ? 3 : length > TWO_A_DAY_ABOVE ? 2 : 1;
  };

  const slotsOn = (date: LondonDate): number[] =>
    patterns[slotCount(date)].map((hhmm) => londonInstant(date, hhmm));

  /** Today's slots no entry has claimed yet, in time order. */
  const openSlotsToday = () => {
    const claimed = new Set(entries.map((e) => e.claimedSlot));
    return slotsOn(today).filter((slot) => !claimed.has(slot));
  };

  /**
   * The Short a slot posts: the oldest in the queue AT the slot. A Short
   * queued after a slot never takes it, even when the slot is still open.
   */
  const takerOf = (
    slot: number,
    from: ReadonlyArray<SlotScheduleEntry>
  ): SlotScheduleEntry | undefined => from.find((e) => e.queuedAt <= slot);

  const project = (): ProjectedPost[] => {
    // A Post Now goes out at the next check, before any slot.
    const projected: ProjectedPost[] = postNow.map((e) => ({
      entryId: e.id,
      slot: now,
    }));
    const take = (slot: number) => {
      const next = takerOf(slot, remaining);
      if (!next) return;
      remaining.splice(remaining.indexOf(next), 1);
      projected.push({ entryId: next.id, slot: Math.max(slot, now) });
    };

    for (const slot of openSlotsToday()) {
      if (remaining.length === 0) break;
      take(slot);
    }
    // Every simulated day has at least one slot, and every queued Short was
    // queued before it, so the walk ends within `queued.length` days.
    for (let day = 1; remaining.length > 0 && day <= queued.length + 7; day++) {
      const date = addLondonDays(today, day);
      for (const slot of slotsOn(date)) {
        if (remaining.length === 0) break;
        take(slot);
      }
    }
    // Slots are walked in time order, so this is posting order. It can
    // differ from queue order: a missed slot takes only a Short queued before it.
    return projected;
  };

  return { postNow, queued, openSlotsToday, takerOf, project };
};

/** When each Queued Short goes out, in posting order. */
export const projectPostingQueue = (
  input: SlotScheduleInput
): ProjectedPost[] => walk(input).project();

/**
 * What the Sidecar's tick should do now: claim the earliest-asked Post Now
 * entry at `now`, or else today's earliest due slot for
 * the oldest Short queued at that slot — one claim per check, and only once
 * the previous claim has settled — or nothing. A slot not claimed by the end
 * of its UK day is dropped: a lost day is not made up.
 */
export const dueNow = (input: SlotScheduleInput): DueNow => {
  const schedule = walk(input);
  const settled = !input.entries.some((e) => e.state === "posting");
  if (settled) {
    const postNow = schedule.postNow[0];
    if (postNow) {
      return { kind: "claim", entryId: postNow.id, slot: input.now };
    }
    for (const slot of schedule.openSlotsToday()) {
      if (slot > input.now) break;
      const taker = schedule.takerOf(slot, schedule.queued);
      if (taker) return { kind: "claim", entryId: taker.id, slot };
    }
  }
  const next = walk(input).project()[0];
  return { kind: "nothing", nextSlot: next ? next.slot : null };
};
