import { describe, expect, it } from "vitest";
import {
  deliverableDisplay,
  type DeliverableForDisplay,
} from "./deliverable-display";

const today = new Date(2026, 4, 18); // 2026-05-18, Monday, ISO week 21

function makeDeliverable(
  overrides: Partial<DeliverableForDisplay>
): DeliverableForDisplay {
  return {
    date: "2026-05-20",
    status: "planned",
    ...overrides,
  };
}

describe("deliverableDisplay", () => {
  it.each([
    // planned × past → overdue-in-week
    {
      label: "planned, past date → overdue-in-week, overdue",
      d: makeDeliverable({ date: "2026-05-10", status: "planned" }),
      expected: { bucket: "overdue-in-week", overdue: true },
    },
    {
      label: "planned, yesterday → overdue-in-week, overdue",
      d: makeDeliverable({ date: "2026-05-17", status: "planned" }),
      expected: { bucket: "overdue-in-week", overdue: true },
    },
    // planned × today → this-week, not overdue
    {
      label: "planned, today → this-week, not overdue",
      d: makeDeliverable({ date: "2026-05-18", status: "planned" }),
      expected: { bucket: "this-week", overdue: false },
    },
    // planned × future same week → this-week
    {
      label: "planned, same ISO week → this-week",
      d: makeDeliverable({ date: "2026-05-24", status: "planned" }),
      expected: { bucket: "this-week", overdue: false },
    },
    // planned × future different week → future-week
    {
      label: "planned, next week → future-week",
      d: makeDeliverable({ date: "2026-05-25", status: "planned" }),
      expected: { bucket: "future-week", overdue: false },
    },

    // done × past → history
    {
      label: "done, past date → history",
      d: makeDeliverable({ date: "2026-05-10", status: "done" }),
      expected: { bucket: "history", overdue: false },
    },
    {
      label: "done, yesterday → history",
      d: makeDeliverable({ date: "2026-05-17", status: "done" }),
      expected: { bucket: "history", overdue: false },
    },
    // done × today → this-week
    {
      label: "done, today → this-week",
      d: makeDeliverable({ date: "2026-05-18", status: "done" }),
      expected: { bucket: "this-week", overdue: false },
    },
    // done × future same week → this-week
    {
      label: "done, same ISO week future → this-week",
      d: makeDeliverable({ date: "2026-05-20", status: "done" }),
      expected: { bucket: "this-week", overdue: false },
    },
    // done × future different week → future-week
    {
      label: "done, future week → future-week",
      d: makeDeliverable({ date: "2026-06-01", status: "done" }),
      expected: { bucket: "future-week", overdue: false },
    },

    // cancelled × past → history
    {
      label: "cancelled, past date → history",
      d: makeDeliverable({ date: "2026-05-05", status: "cancelled" }),
      expected: { bucket: "history", overdue: false },
    },
    // cancelled × today → this-week
    {
      label: "cancelled, today → this-week",
      d: makeDeliverable({ date: "2026-05-18", status: "cancelled" }),
      expected: { bucket: "this-week", overdue: false },
    },
    // cancelled × future same week → this-week
    {
      label: "cancelled, same ISO week → this-week",
      d: makeDeliverable({ date: "2026-05-19", status: "cancelled" }),
      expected: { bucket: "this-week", overdue: false },
    },
    // cancelled × future different week → future-week
    {
      label: "cancelled, future week → future-week",
      d: makeDeliverable({ date: "2026-06-01", status: "cancelled" }),
      expected: { bucket: "future-week", overdue: false },
    },
  ])("$label", ({ d, expected }) => {
    expect(deliverableDisplay(d, today)).toEqual(expected);
  });

  it("done, past day in current week → this-week (not history)", () => {
    // Today = Wednesday 2026-05-20 (ISO week 21)
    // Monday 2026-05-18 is past but same ISO week
    const wednesday = new Date(2026, 4, 20);
    const d = makeDeliverable({ date: "2026-05-18", status: "done" });
    expect(deliverableDisplay(d, wednesday)).toEqual({
      bucket: "this-week",
      overdue: false,
    });
  });

  it("cancelled, past day in current week → this-week (not history)", () => {
    const wednesday = new Date(2026, 4, 20);
    const d = makeDeliverable({ date: "2026-05-19", status: "cancelled" });
    expect(deliverableDisplay(d, wednesday)).toEqual({
      bucket: "this-week",
      overdue: false,
    });
  });
});
