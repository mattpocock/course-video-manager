import { describe, expect, it } from "vitest";
import {
  dueNow,
  projectPostingQueue,
  SLOT_PATTERNS,
  type SlotScheduleEntry,
} from "./slot-schedule.js";

/**
 * The Slot Schedule, as a pure function: given `now`, the Posting Queue's
 * entries and the slot patterns. Every expected instant below is a hand-
 * written UTC literal; November is GMT (UK = UTC), July is BST (UK = UTC+1).
 *
 * 2026-11-03 is a Tuesday; 2026-10-30 a Friday; 2026-10-31/11-01 the weekend.
 */

const at = (iso: string) => new Date(iso).getTime();

let seq = 0;
const entry = (
  over: Partial<SlotScheduleEntry> & { queuedAt: number }
): SlotScheduleEntry => {
  seq++;
  return {
    id: `e${String(seq).padStart(3, "0")}`,
    order: `a${String(seq).padStart(4, "0")}`,
    state: "queued",
    claimedSlot: null,
    endedAt: null,
    ...over,
  };
};

/** `n` Queued entries, queued (in order) at `queuedAt`. */
const queued = (n: number, queuedAt: number) =>
  Array.from({ length: n }, () => entry({ queuedAt }));

/** A Posted entry that claimed `slot`, queued long before. */
const postedAt = (slot: string) =>
  entry({
    queuedAt: at(slot) - 30 * 24 * 3_600_000,
    state: "posted",
    claimedSlot: at(slot),
    endedAt: at(slot) + 60_000,
  });

const iso = (ms: number) => new Date(ms).toISOString();

const project = (now: number, entries: SlotScheduleEntry[]) =>
  projectPostingQueue({ now, entries, patterns: SLOT_PATTERNS }).map((p) =>
    iso(p.slot)
  );

/** The UTC instants today's (and later days') slots go out at, from `now`. */
const firstDaySlots = (now: number, entries: SlotScheduleEntry[]) =>
  project(now, entries).filter((s) => s.startsWith(iso(now).slice(0, 10)));

/** A clock just after a weekday's midnight, with no history before it. */
const TUE = at("2026-11-03T00:00:01Z");
const BEFORE_TUE = at("2026-11-02T20:00:00Z");
/** Yesterday (Monday) was posted at its slot, so no catch-up applies. */
const mondayPosted = () => [postedAt("2026-11-02T13:00:00Z")];

describe("the day's slot count, from the queue length at 00:00 UK time", () => {
  it.each([
    [1, ["2026-11-03T13:00:00.000Z"]],
    [14, ["2026-11-03T13:00:00.000Z"]],
    [15, ["2026-11-03T09:00:00.000Z", "2026-11-03T18:00:00.000Z"]],
    [21, ["2026-11-03T09:00:00.000Z", "2026-11-03T18:00:00.000Z"]],
    [
      22,
      [
        "2026-11-03T09:00:00.000Z",
        "2026-11-03T13:00:00.000Z",
        "2026-11-03T18:00:00.000Z",
      ],
    ],
  ])("a weekday with %i queued posts at %j", (n, slots) => {
    expect(
      firstDaySlots(TUE, [...mondayPosted(), ...queued(n, BEFORE_TUE)])
    ).toEqual(slots);
  });

  it("a weekend day posts once, however long the queue", () => {
    const sat = at("2026-10-31T00:00:01Z");
    const entries = [
      postedAt("2026-10-30T09:00:00Z"),
      postedAt("2026-10-30T13:00:00Z"),
      postedAt("2026-10-30T18:00:00Z"),
      ...queued(30, at("2026-10-29T12:00:00Z")),
    ];
    expect(firstDaySlots(sat, entries)).toEqual(["2026-10-31T13:00:00.000Z"]);
  });

  it("an empty queue has no slots, and nothing is due", () => {
    expect(project(TUE, mondayPosted())).toEqual([]);
    expect(
      dueNow({
        now: at("2026-11-03T13:05:00Z"),
        entries: mondayPosted(),
        patterns: SLOT_PATTERNS,
      })
    ).toEqual({ kind: "nothing", nextSlot: null });
  });

  it("is fixed at 00:00: Shorts queued later that day do not add a slot", () => {
    const entries = [
      ...mondayPosted(),
      ...queued(14, BEFORE_TUE),
      ...queued(10, at("2026-11-03T08:00:00Z")),
    ];
    expect(firstDaySlots(at("2026-11-03T08:30:00Z"), entries)).toEqual([
      "2026-11-03T13:00:00.000Z",
    ]);
  });
});

describe("a day whose queue was empty at 00:00 has no slots", () => {
  /** Friday posted at its slot; the weekend's queue empty. */
  const fridayPosted = () => [postedAt("2026-10-30T13:00:00Z")];

  it.each([
    ["a weekday", mondayPosted, "2026-11-03", "2026-11-04T13:00:00.000Z"],
    ["a weekend day", fridayPosted, "2026-10-31", "2026-11-01T13:00:00.000Z"],
  ])(
    "on %s, a Short queued at 10:00 waits for the next day's slot",
    (_, history, day, next) => {
      const entries = [
        ...history(),
        entry({ queuedAt: at(`${day}T10:00:00Z`) }),
      ];
      expect(project(at(`${day}T10:00:01Z`), entries)).toEqual([next]);
      expect(
        dueNow({
          now: at(`${day}T13:01:00Z`),
          entries,
          patterns: SLOT_PATTERNS,
        })
      ).toEqual({ kind: "nothing", nextSlot: at(next) });
    }
  );

  it("and is not a missed day: no catch-up after it", () => {
    // Monday's queue was empty at 00:00; a Short queued Monday evening.
    const entries = [entry({ queuedAt: at("2026-11-02T20:00:00Z") })];
    expect(firstDaySlots(TUE, entries)).toEqual(["2026-11-03T13:00:00.000Z"]);
  });
});

describe("a missed slot", () => {
  it("is taken later that day only by a Short queued before it", () => {
    // 15 queued at 00:00 → 09:00 and 18:00; all taken off the queue at 08:00.
    const removed = queued(15, BEFORE_TUE).map((e) => ({
      ...e,
      state: "removed" as const,
      endedAt: at("2026-11-03T08:00:00Z"),
    }));
    const late = entry({ queuedAt: at("2026-11-03T09:30:00Z") });
    const entries = [...mondayPosted(), ...removed, late];
    const now = at("2026-11-03T10:00:00Z");
    expect(dueNow({ now, entries, patterns: SLOT_PATTERNS })).toEqual({
      kind: "nothing",
      nextSlot: at("2026-11-03T18:00:00Z"),
    });
  });
});

describe("catch-up", () => {
  it("a weekday after a missed weekday uses the next pattern up", () => {
    // Monday had a slot (queue non-empty at its midnight), and nothing claimed it.
    const entries = queued(3, at("2026-11-01T20:00:00Z"));
    expect(firstDaySlots(TUE, entries)).toEqual([
      "2026-11-03T09:00:00.000Z",
      "2026-11-03T18:00:00.000Z",
    ]);
  });

  it("is one extra Short at most, and 3 stays 3", () => {
    const entries = queued(22, at("2026-11-01T20:00:00Z"));
    expect(firstDaySlots(TUE, entries)).toHaveLength(3);
  });

  it("Monday catches up a missed Friday", () => {
    const mon = at("2026-11-02T00:00:01Z");
    const entries = [
      postedAt("2026-10-31T13:00:00Z"),
      postedAt("2026-11-01T13:00:00Z"),
      ...queued(5, at("2026-10-29T20:00:00Z")),
    ];
    expect(firstDaySlots(mon, entries)).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T18:00:00.000Z",
    ]);
  });

  it("a missed weekend day carries to Monday, and the weekend never catches up", () => {
    const sun = at("2026-11-01T00:00:01Z");
    // Friday posted; Saturday had a slot and claimed none.
    const entries = [
      postedAt("2026-10-30T13:00:00Z"),
      ...queued(5, at("2026-10-30T20:00:00Z")),
    ];
    expect(project(sun, entries)).toEqual([
      "2026-11-01T13:00:00.000Z", // Sunday: still 1
      "2026-11-02T09:00:00.000Z", // Monday: 2, for the missed Saturday
      "2026-11-02T18:00:00.000Z",
      "2026-11-03T13:00:00.000Z",
      "2026-11-04T13:00:00.000Z",
    ]);
  });
});

describe("what is due now", () => {
  it("claims the slot for the oldest-queued Short once the slot is due", () => {
    const entries = [...mondayPosted(), ...queued(2, BEFORE_TUE)];
    expect(
      dueNow({
        now: at("2026-11-03T12:59:00Z"),
        entries,
        patterns: SLOT_PATTERNS,
      })
    ).toEqual({ kind: "nothing", nextSlot: at("2026-11-03T13:00:00Z") });
    expect(
      dueNow({
        now: at("2026-11-03T13:02:00Z"),
        entries,
        patterns: SLOT_PATTERNS,
      })
    ).toEqual({
      kind: "claim",
      entryId: entries[1]!.id,
      slot: at("2026-11-03T13:00:00Z"),
    });
  });

  it("takes missed slots one per check, only once the last claim settled", () => {
    // 22 queued: 09:00, 13:00 and 18:00. CVM was off until 14:00.
    const entries = [...mondayPosted(), ...queued(22, BEFORE_TUE)];
    const now = at("2026-11-03T14:00:00Z");
    const first = dueNow({ now, entries, patterns: SLOT_PATTERNS });
    expect(first).toEqual({
      kind: "claim",
      entryId: entries[1]!.id,
      slot: at("2026-11-03T09:00:00Z"),
    });

    // The 09:00 claim is still Posting: nothing more this check.
    entries[1] = {
      ...entries[1]!,
      state: "posting",
      claimedSlot: at("2026-11-03T09:00:00Z"),
    };
    expect(
      dueNow({ now: now + 120_000, entries, patterns: SLOT_PATTERNS })
    ).toMatchObject({ kind: "nothing" });

    // Settled: the next check takes the 13:00 slot.
    entries[1] = { ...entries[1]!, state: "posted", endedAt: now + 200_000 };
    expect(
      dueNow({ now: now + 240_000, entries, patterns: SLOT_PATTERNS })
    ).toEqual({
      kind: "claim",
      entryId: entries[2]!.id,
      slot: at("2026-11-03T13:00:00Z"),
    });
  });

  it("drops a slot not claimed by the end of the UK day", () => {
    const entries = [...mondayPosted(), ...queued(2, BEFORE_TUE)];
    // Tuesday's 13:00 was never claimed; Wednesday 00:30 has nothing due.
    expect(
      dueNow({
        now: at("2026-11-04T00:30:00Z"),
        entries,
        patterns: SLOT_PATTERNS,
      })
    ).toMatchObject({ kind: "nothing" });
  });
});

describe("UK time across the clock changes", () => {
  it("13:00 stays 13:00 UK on the last Sunday of March (BST starts)", () => {
    const entries = [
      postedAt("2027-03-27T13:00:00Z"),
      ...queued(1, at("2027-03-27T20:00:00Z")),
    ];
    expect(project(at("2027-03-28T00:00:01Z"), entries)).toEqual([
      "2027-03-28T12:00:00.000Z",
    ]);
  });

  it("13:00 stays 13:00 UK on the last Sunday of October (GMT returns)", () => {
    const entries = [
      postedAt("2026-10-24T12:00:00Z"),
      ...queued(1, at("2026-10-24T20:00:00Z")),
    ];
    expect(project(at("2026-10-25T00:00:01Z"), entries)).toEqual([
      "2026-10-25T13:00:00.000Z",
    ]);
  });

  it("a UK day begins at its own midnight, while UTC is still on the day before", () => {
    // BST: Wednesday 15 July begins at 2026-07-14T23:00Z.
    const tuePosted = postedAt("2026-07-14T12:00:00Z");
    const beforeMidnight = entry({ queuedAt: at("2026-07-14T22:59:00Z") });
    const afterMidnight = entry({ queuedAt: at("2026-07-14T23:01:00Z") });
    const entries = [tuePosted, beforeMidnight, afterMidnight];
    // Only the first was queued at Wednesday's 00:00, so Wednesday has 1 slot.
    expect(project(at("2026-07-14T23:30:00Z"), entries)).toEqual([
      "2026-07-15T12:00:00.000Z",
      "2026-07-16T12:00:00.000Z",
    ]);
  });
});

describe("when each queued Short goes out", () => {
  it("projects 20 queued Shorts across a week, oldest first", () => {
    const entries = [...mondayPosted(), ...queued(20, BEFORE_TUE)];
    const projection = projectPostingQueue({
      now: TUE,
      entries,
      patterns: SLOT_PATTERNS,
    });
    expect(projection.map((p) => p.entryId)).toEqual(
      entries.slice(1).map((e) => e.id)
    );
    expect(projection.map((p) => iso(p.slot))).toEqual([
      // Tue: 20 queued → 2
      "2026-11-03T09:00:00.000Z",
      "2026-11-03T18:00:00.000Z",
      // Wed: 18 → 2
      "2026-11-04T09:00:00.000Z",
      "2026-11-04T18:00:00.000Z",
      // Thu: 16 → 2
      "2026-11-05T09:00:00.000Z",
      "2026-11-05T18:00:00.000Z",
      // Fri: 14 → 1
      "2026-11-06T13:00:00.000Z",
      // Sat, Sun: 1
      "2026-11-07T13:00:00.000Z",
      "2026-11-08T13:00:00.000Z",
      // Mon 11 → Fri 7, then Sat, Sun, Mon …: 1 a day
      "2026-11-09T13:00:00.000Z",
      "2026-11-10T13:00:00.000Z",
      "2026-11-11T13:00:00.000Z",
      "2026-11-12T13:00:00.000Z",
      "2026-11-13T13:00:00.000Z",
      "2026-11-14T13:00:00.000Z",
      "2026-11-15T13:00:00.000Z",
      "2026-11-16T13:00:00.000Z",
      "2026-11-17T13:00:00.000Z",
      "2026-11-18T13:00:00.000Z",
      "2026-11-19T13:00:00.000Z",
    ]);
  });

  it("puts a missed slot still open today at the next check", () => {
    const entries = [...mondayPosted(), ...queued(1, BEFORE_TUE)];
    const now = at("2026-11-03T15:00:00Z");
    expect(project(now, entries)).toEqual([iso(now)]);
  });

  it("skips a slot already claimed, and an entry already Posting", () => {
    const posting = entry({
      queuedAt: BEFORE_TUE - 1,
      state: "posting",
      claimedSlot: at("2026-11-03T13:00:00Z"),
    });
    const entries = [...mondayPosted(), posting, ...queued(1, BEFORE_TUE)];
    expect(project(at("2026-11-03T13:01:00Z"), entries)).toEqual([
      "2026-11-04T13:00:00.000Z",
    ]);
  });
});
