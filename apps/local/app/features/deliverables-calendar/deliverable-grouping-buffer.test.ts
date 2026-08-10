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

describe("groupDeliverables — overdueCutoffStr (buffer weeks)", () => {
  it("buffer=0 reproduces default overdue behaviour (date < today)", () => {
    // today = 2026-05-18; item on 2026-05-17 should be overdue with no buffer
    const items = [
      makeDeliverable({
        date: "2026-05-17",
        title: "Yesterday",
        status: "planned",
      }),
      makeDeliverable({
        date: "2026-05-18",
        title: "Today",
        status: "planned",
      }),
    ];
    const result = groupDeliverables(items, today, {
      overdueCutoffStr: "2026-05-18",
    });
    const week20 = result.weekGroups.find((g) => g.week === 20);
    const week21 = result.weekGroups.find((g) => g.week === 21);
    expect(week20!.overdueCount).toBe(1);
    expect(week21!.overdueCount).toBe(0);
  });

  it("buffer=1 week marks planned items within the next 7 days as overdue", () => {
    // today = 2026-05-18; cutoff = 2026-05-25 (today + 7)
    const items = [
      makeDeliverable({
        date: "2026-05-20",
        title: "Within buffer",
        status: "planned",
      }),
      makeDeliverable({
        date: "2026-05-25",
        title: "On the cutoff boundary (not overdue)",
        status: "planned",
      }),
      makeDeliverable({
        date: "2026-05-26",
        title: "Beyond buffer",
        status: "planned",
      }),
    ];
    const result = groupDeliverables(items, today, {
      overdueCutoffStr: "2026-05-25",
    });
    // May 20 (week 21) is < cutoff; May 25 is == cutoff (not overdue); May 26 is beyond
    const week21 = result.weekGroups.find((g) => g.week === 21);
    const week22 = result.weekGroups.find((g) => g.week === 22);
    expect(week21!.overdueCount).toBe(1); // May 20 < May 25
    expect(week22!.overdueCount).toBe(0); // May 25 is NOT < May 25; May 26 is beyond
  });

  it("buffer does not affect pastHistory bucketing — only overdueCount changes", () => {
    // Past done items must still go to pastHistory regardless of buffer
    const items = [
      makeDeliverable({
        date: "2026-05-10",
        title: "Past done",
        status: "done",
      }),
      makeDeliverable({
        date: "2026-05-10",
        title: "Past cancelled",
        status: "cancelled",
      }),
    ];
    const result = groupDeliverables(items, today, {
      overdueCutoffStr: "2026-06-01",
    });
    expect(result.pastHistory).toHaveLength(2);
    expect(result.weekGroups.flatMap((g) => g.items)).toHaveLength(0);
  });

  it("buffer does not count done or cancelled items as overdue even within buffer", () => {
    // done/cancelled future items — overdueCount should still be 0
    const items = [
      makeDeliverable({
        date: "2026-05-20",
        title: "Future done",
        status: "done",
      }),
      makeDeliverable({
        date: "2026-05-20",
        title: "Future cancelled",
        status: "cancelled",
      }),
    ];
    const result = groupDeliverables(items, today, {
      overdueCutoffStr: "2026-05-25",
    });
    const week21 = result.weekGroups.find((g) => g.week === 21);
    expect(week21!.overdueCount).toBe(0);
  });

  it("buffer=0 with explicit cutoff=todayStr exactly matches no-option behaviour", () => {
    const items = [
      makeDeliverable({
        date: "2026-05-15",
        title: "Past planned",
        status: "planned",
      }),
    ];
    const withOption = groupDeliverables(items, today, {
      overdueCutoffStr: "2026-05-18",
    });
    const withoutOption = groupDeliverables(items, today);
    const week20a = withOption.weekGroups.find((g) => g.week === 20);
    const week20b = withoutOption.weekGroups.find((g) => g.week === 20);
    expect(week20a!.overdueCount).toBe(week20b!.overdueCount);
  });
});
