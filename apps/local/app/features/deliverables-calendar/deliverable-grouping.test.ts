import { describe, expect, it } from "vitest";
import {
  groupDeliverables,
  type DeliverableForGrouping,
} from "./deliverable-grouping";

const today = new Date(2026, 4, 18); // 2026-05-18, Monday, ISO week 21

function makeDeliverable(
  overrides: Partial<DeliverableForGrouping> &
    Pick<DeliverableForGrouping, "date">
): DeliverableForGrouping {
  const { date, ...rest } = overrides;
  return {
    id: crypto.randomUUID(),
    title: "Test",
    notes: null,
    date,
    status: "planned",
    archived: false,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    ...rest,
  };
}

describe("groupDeliverables", () => {
  it("returns current week even when no items exist", () => {
    const result = groupDeliverables([], today);
    expect(result.pastHistory).toEqual([]);
    expect(result.weekGroups).toHaveLength(1);
    expect(result.weekGroups[0]!.week).toBe(21);
    expect(result.weekGroups[0]!.year).toBe(2026);
    expect(result.weekGroups[0]!.items).toEqual([]);
    expect(result.weekGroups[0]!.overdueCount).toBe(0);
  });

  it("groups items into correct weeks", () => {
    const items = [
      makeDeliverable({ date: "2026-05-19", title: "A" }),
      makeDeliverable({ date: "2026-05-26", title: "B" }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups).toHaveLength(2);
    expect(result.weekGroups[0]!.week).toBe(21);
    expect(result.weekGroups[0]!.items).toHaveLength(1);
    expect(result.weekGroups[0]!.items[0]!.title).toBe("A");
    expect(result.weekGroups[1]!.week).toBe(22);
    expect(result.weekGroups[1]!.items).toHaveLength(1);
    expect(result.weekGroups[1]!.items[0]!.title).toBe("B");
  });

  it("sorts items within a week by date asc, then createdAt asc", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-21",
        title: "Later date",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
      makeDeliverable({
        date: "2026-05-19",
        title: "Earlier date",
        createdAt: new Date("2026-05-02T00:00:00Z"),
      }),
      makeDeliverable({
        date: "2026-05-19",
        title: "Same date, earlier created",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups[0]!.items.map((i) => i.title)).toEqual([
      "Same date, earlier created",
      "Earlier date",
      "Later date",
    ]);
  });

  it("sorts week groups by year-week ascending", () => {
    const items = [
      makeDeliverable({ date: "2026-06-01", title: "Week 23" }),
      makeDeliverable({ date: "2026-05-19", title: "Week 21" }),
      makeDeliverable({ date: "2026-05-25", title: "Week 22" }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups.map((g) => g.week)).toEqual([21, 22, 23]);
  });

  it("filters out archived items from both weekGroups and pastHistory", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-19",
        title: "Visible",
        archived: false,
      }),
      makeDeliverable({
        date: "2026-05-20",
        title: "Archived future",
        archived: true,
      }),
      makeDeliverable({
        date: "2026-05-10",
        title: "Archived past done",
        archived: true,
        status: "done",
      }),
    ];
    const result = groupDeliverables(items, today);
    const allItems = result.weekGroups.flatMap((g) => g.items);
    expect(allItems).toHaveLength(1);
    expect(allItems[0]!.title).toBe("Visible");
    expect(result.pastHistory).toHaveLength(0);
  });

  it("fills at least minWeeksAhead future weeks even when no items exist", () => {
    const result = groupDeliverables([], today, { minWeeksAhead: 11 });
    expect(result.weekGroups).toHaveLength(12);
    expect(result.weekGroups[0]!.week).toBe(21);
    expect(result.weekGroups[11]!.week).toBe(32);
    expect(result.weekGroups.every((g) => g.items.length === 0)).toBe(true);
  });

  it("extends past minWeeksAhead when items reach further", () => {
    const items = [
      makeDeliverable({ date: "2026-09-01", title: "Far future" }),
    ];
    const result = groupDeliverables(items, today, { minWeeksAhead: 4 });
    // 2026-09-01 = ISO week 36; should fill from 21 through 36
    expect(result.weekGroups[0]!.week).toBe(21);
    expect(result.weekGroups[result.weekGroups.length - 1]!.week).toBe(36);
  });

  it("includes current week and fills empty weeks up to the latest scheduled deliverable", () => {
    const items = [makeDeliverable({ date: "2026-06-01", title: "Future" })];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups.map((g) => g.week)).toEqual([21, 22, 23]);
    expect(result.weekGroups[0]!.items).toEqual([]);
    expect(result.weekGroups[1]!.items).toEqual([]);
    expect(result.weekGroups[2]!.items.map((i) => i.title)).toEqual(["Future"]);
  });

  it("handles multiple items on the same day sorted by createdAt", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-20",
        title: "Second created",
        createdAt: new Date("2026-05-10T12:00:00Z"),
      }),
      makeDeliverable({
        date: "2026-05-20",
        title: "First created",
        createdAt: new Date("2026-05-10T08:00:00Z"),
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups[0]!.items.map((i) => i.title)).toEqual([
      "First created",
      "Second created",
    ]);
  });

  it("returns only current week when all items are archived", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-19",
        title: "Archived A",
        archived: true,
      }),
      makeDeliverable({
        date: "2026-05-26",
        title: "Archived B",
        archived: true,
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups).toHaveLength(1);
    expect(result.weekGroups[0]!.week).toBe(21);
    expect(result.weekGroups[0]!.items).toEqual([]);
    expect(result.pastHistory).toEqual([]);
  });

  it("groups correctly across year boundary where ISO year differs from calendar year", () => {
    const yearEnd = new Date(2025, 11, 29); // 2025-12-29, ISO week 1 of 2026
    const items = [
      makeDeliverable({ date: "2025-12-28", title: "Week 52 of 2025" }),
      makeDeliverable({ date: "2025-12-29", title: "Week 1 of 2026" }),
      makeDeliverable({ date: "2026-01-02", title: "Also week 1 of 2026" }),
    ];
    const result = groupDeliverables(items, yearEnd);
    expect(result.weekGroups).toHaveLength(2);
    expect(result.weekGroups[0]!.year).toBe(2025);
    expect(result.weekGroups[0]!.week).toBe(52);
    expect(result.weekGroups[0]!.items[0]!.title).toBe("Week 52 of 2025");
    expect(result.weekGroups[1]!.year).toBe(2026);
    expect(result.weekGroups[1]!.week).toBe(1);
    expect(result.weekGroups[1]!.items.map((i) => i.title)).toEqual([
      "Week 1 of 2026",
      "Also week 1 of 2026",
    ]);
  });

  it("keeps past planned (overdue) items inline in week groups", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-11",
        title: "Overdue in week 20",
        status: "planned",
      }),
      makeDeliverable({ date: "2026-05-19", title: "This week 21" }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory).toHaveLength(0);
    expect(result.weekGroups.map((g) => g.week)).toEqual([20, 21]);
    expect(result.weekGroups[0]!.items[0]!.title).toBe("Overdue in week 20");
    expect(result.weekGroups[1]!.items[0]!.title).toBe("This week 21");
  });

  // ─── pastHistory tests ──────────────────────────────────────────────

  it("moves past done items to pastHistory sorted date-desc", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-05",
        title: "Done early May",
        status: "done",
      }),
      makeDeliverable({
        date: "2026-05-14",
        title: "Done mid May",
        status: "done",
      }),
      makeDeliverable({
        date: "2026-05-10",
        title: "Done May 10",
        status: "done",
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory.map((d) => d.title)).toEqual([
      "Done mid May",
      "Done May 10",
      "Done early May",
    ]);
    const allWeekItems = result.weekGroups.flatMap((g) => g.items);
    expect(allWeekItems).toHaveLength(0);
  });

  it("moves past cancelled items to pastHistory", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-12",
        title: "Cancelled past",
        status: "cancelled",
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory).toHaveLength(1);
    expect(result.pastHistory[0]!.title).toBe("Cancelled past");
  });

  it("keeps future-dated cancelled items inline, not in pastHistory", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-25",
        title: "Future cancelled",
        status: "cancelled",
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory).toHaveLength(0);
    expect(result.weekGroups[1]!.items[0]!.title).toBe("Future cancelled");
  });

  it("keeps today-dated done items inline, not in pastHistory", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-18",
        title: "Done today",
        status: "done",
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory).toHaveLength(0);
    expect(result.weekGroups[0]!.items[0]!.title).toBe("Done today");
  });

  it("keeps future-dated done items inline", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-20",
        title: "Done ahead of plan",
        status: "done",
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory).toHaveLength(0);
    expect(result.weekGroups[0]!.items[0]!.title).toBe("Done ahead of plan");
  });

  it("pastHistory uses createdAt desc as tie-breaker when dates match", () => {
    const items = [
      makeDeliverable({
        id: "first-created",
        date: "2026-05-10",
        title: "Created first",
        status: "done",
        createdAt: new Date("2026-05-01T08:00:00Z"),
      }),
      makeDeliverable({
        id: "second-created",
        date: "2026-05-10",
        title: "Created second",
        status: "done",
        createdAt: new Date("2026-05-01T16:00:00Z"),
      }),
      makeDeliverable({
        id: "third-created",
        date: "2026-05-10",
        title: "Created third",
        status: "cancelled",
        createdAt: new Date("2026-05-01T12:00:00Z"),
      }),
    ];
    const result = groupDeliverables(items, today);
    expect(result.pastHistory.map((d) => d.id)).toEqual([
      "second-created",
      "third-created",
      "first-created",
    ]);
  });

  // ─── overdueCount tests ─────────────────────────────────────────────

  it("computes overdueCount per week group", () => {
    const items = [
      // 2026-05-16 = Saturday → ISO week 20
      makeDeliverable({
        date: "2026-05-16",
        title: "Overdue A (week 20)",
        status: "planned",
      }),
      // 2026-05-17 = Sunday → ISO week 20
      makeDeliverable({
        date: "2026-05-17",
        title: "Overdue B (week 20)",
        status: "planned",
      }),
      // 2026-05-11 = Monday → ISO week 20
      makeDeliverable({
        date: "2026-05-11",
        title: "Overdue C (week 20)",
        status: "planned",
      }),
      makeDeliverable({ date: "2026-05-19", title: "Normal this week" }),
    ];
    const result = groupDeliverables(items, today);
    const week20 = result.weekGroups.find((g) => g.week === 20);
    const week21 = result.weekGroups.find((g) => g.week === 21);
    expect(week20!.overdueCount).toBe(3);
    expect(week21!.overdueCount).toBe(0);
  });

  it("overdueCount is 0 when no overdue items in week", () => {
    const items = [makeDeliverable({ date: "2026-05-19", title: "Normal" })];
    const result = groupDeliverables(items, today);
    expect(result.weekGroups[0]!.overdueCount).toBe(0);
  });

  it("does not count done or cancelled as overdue even when past", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-16",
        title: "Past done",
        status: "done",
      }),
      makeDeliverable({
        date: "2026-05-16",
        title: "Past cancelled",
        status: "cancelled",
      }),
      makeDeliverable({
        date: "2026-05-16",
        title: "Past planned = overdue",
        status: "planned",
      }),
    ];
    const result = groupDeliverables(items, today);
    // done and cancelled go to pastHistory, only planned stays inline
    expect(result.pastHistory).toHaveLength(2);
    const week20 = result.weekGroups.find((g) => g.week === 20);
    expect(week20!.overdueCount).toBe(1);
    expect(week20!.items).toHaveLength(1);
  });

  it("archived overdue item excluded from both weekGroups and overdueCount", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-16",
        title: "Archived overdue",
        status: "planned",
        archived: true,
      }),
      makeDeliverable({
        date: "2026-05-16",
        title: "Active overdue",
        status: "planned",
        archived: false,
      }),
    ];
    const result = groupDeliverables(items, today);
    const week20 = result.weekGroups.find((g) => g.week === 20);
    expect(week20!.items).toHaveLength(1);
    expect(week20!.items[0]!.title).toBe("Active overdue");
    expect(week20!.overdueCount).toBe(1);
  });

  // ─── Integration test with mixed dataset ────────────────────────────

  it("integration: full dataset matches expected pastHistory and weekGroups shape", () => {
    // ISO week reference for 2026:
    // Week 19: Mon May 4 – Sun May 10
    // Week 20: Mon May 11 – Sun May 17
    // Week 21: Mon May 18 – Sun May 24 (this week)
    // Week 22: Mon May 25 – Sun May 31
    // Week 23: Mon Jun 1 – Sun Jun 7
    const items = [
      // Past done → history
      makeDeliverable({
        id: "d1",
        date: "2026-05-05",
        title: "Shipped module 1",
        status: "done",
      }),
      makeDeliverable({
        id: "d2",
        date: "2026-05-14",
        title: "Shipped branded types",
        status: "done",
      }),
      // Past cancelled → history
      makeDeliverable({
        id: "d3",
        date: "2026-05-12",
        title: "Cancelled talk dry run",
        status: "cancelled",
      }),
      // Past planned → overdue, stays inline
      makeDeliverable({
        id: "d4",
        date: "2026-05-16",
        title: "Overdue conditional types",
        status: "planned",
      }),
      makeDeliverable({
        id: "d5",
        date: "2026-05-10",
        title: "Overdue tuple inference",
        status: "planned",
      }),
      // This week items
      makeDeliverable({
        id: "d6",
        date: "2026-05-19",
        title: "satisfies short",
        status: "planned",
      }),
      makeDeliverable({
        id: "d7",
        date: "2026-05-21",
        title: "Generics deep-dive",
        status: "planned",
      }),
      // Future week
      makeDeliverable({
        id: "d8",
        date: "2026-05-26",
        title: "Effect teaser",
        status: "planned",
      }),
      // Future cancelled (stays inline)
      makeDeliverable({
        id: "d9",
        date: "2026-06-02",
        title: "Cancelled future thing",
        status: "cancelled",
      }),
      // Archived — excluded from everything
      makeDeliverable({
        id: "d10",
        date: "2026-05-08",
        title: "Archived done",
        status: "done",
        archived: true,
      }),
    ];

    const result = groupDeliverables(items, today);

    // pastHistory: past done + past cancelled, sorted date desc
    expect(result.pastHistory.map((d) => d.id)).toEqual(["d2", "d3", "d1"]);

    // weekGroups: week 19 (d5), week 20 (d4), week 21 (d6,d7), week 22 (d8), week 23 (d9)
    expect(result.weekGroups.map((g) => g.week)).toEqual([19, 20, 21, 22, 23]);

    // Week 19: 1 overdue item (d5 = May 10, Sunday of week 19)
    expect(result.weekGroups[0]!.items.map((d) => d.id)).toEqual(["d5"]);
    expect(result.weekGroups[0]!.overdueCount).toBe(1);

    // Week 20: 1 overdue item (d4 = May 16, Saturday of week 20)
    expect(result.weekGroups[1]!.items.map((d) => d.id)).toEqual(["d4"]);
    expect(result.weekGroups[1]!.overdueCount).toBe(1);

    // Week 21 (this week): 2 normal items, no overdue
    expect(result.weekGroups[2]!.items.map((d) => d.id)).toEqual(["d6", "d7"]);
    expect(result.weekGroups[2]!.overdueCount).toBe(0);

    // Week 22: 1 future item
    expect(result.weekGroups[3]!.items.map((d) => d.id)).toEqual(["d8"]);
    expect(result.weekGroups[3]!.overdueCount).toBe(0);

    // Week 23: 1 future cancelled item
    expect(result.weekGroups[4]!.items.map((d) => d.id)).toEqual(["d9"]);
    expect(result.weekGroups[4]!.overdueCount).toBe(0);
  });

  it("keeps current-week past done/cancelled items inline, not in pastHistory", () => {
    // Today is Wednesday (2026-05-20), ISO week 21
    // Monday and Tuesday are past but same ISO week
    const wednesday = new Date(2026, 4, 20);
    const items = [
      makeDeliverable({
        date: "2026-05-18",
        title: "Done Monday",
        status: "done",
      }),
      makeDeliverable({
        date: "2026-05-19",
        title: "Cancelled Tuesday",
        status: "cancelled",
      }),
    ];
    const result = groupDeliverables(items, wednesday);
    expect(result.pastHistory).toHaveLength(0);
    expect(result.weekGroups[0]!.week).toBe(21);
    expect(result.weekGroups[0]!.items).toHaveLength(2);
    expect(result.weekGroups[0]!.items.map((i) => i.title)).toEqual([
      "Done Monday",
      "Cancelled Tuesday",
    ]);
  });

  it("still moves previous-week past done items to pastHistory", () => {
    // Today is Wednesday (2026-05-20), ISO week 21
    // 2026-05-15 (Friday) is ISO week 20 — should go to pastHistory
    const wednesday = new Date(2026, 4, 20);
    const items = [
      makeDeliverable({
        date: "2026-05-15",
        title: "Done last week",
        status: "done",
      }),
    ];
    const result = groupDeliverables(items, wednesday);
    expect(result.pastHistory).toHaveLength(1);
    expect(result.pastHistory[0]!.title).toBe("Done last week");
  });

  it("preserves extra properties on extended types through grouping", () => {
    interface Extended extends DeliverableForGrouping {
      linkedCourses: { id: string; name: string }[];
    }

    const items: Extended[] = [
      {
        ...makeDeliverable({
          date: "2026-05-10",
          title: "Past done",
          status: "done",
        }),
        linkedCourses: [{ id: "c1", name: "Course 1" }],
      },
      {
        ...makeDeliverable({ date: "2026-05-19", title: "This week" }),
        linkedCourses: [
          { id: "c2", name: "Course 2" },
          { id: "c3", name: "Course 3" },
        ],
      },
    ];

    const result = groupDeliverables(items, today);

    expect(result.pastHistory[0]!.linkedCourses).toEqual([
      { id: "c1", name: "Course 1" },
    ]);
    expect(result.weekGroups[0]!.items[0]!.linkedCourses).toEqual([
      { id: "c2", name: "Course 2" },
      { id: "c3", name: "Course 3" },
    ]);
  });
});
