import { describe, expect, it } from "vitest";
import { isoWeek, isoWeekStart } from "./iso-week";

function d(s: string): Date {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y!, m! - 1, day!);
}

describe("isoWeek", () => {
  it.each([
    { date: "2026-05-18", week: 21, year: 2026 },
    { date: "2026-01-01", week: 1, year: 2026 },
    { date: "2026-12-31", week: 53, year: 2026 },
    { date: "2025-12-29", week: 1, year: 2026 },
    { date: "2025-01-01", week: 1, year: 2025 },
    { date: "2024-12-30", week: 1, year: 2025 },
    { date: "2024-12-29", week: 52, year: 2024 },
    { date: "2024-01-01", week: 1, year: 2024 },
    { date: "2023-01-01", week: 52, year: 2022 },
    { date: "2023-01-02", week: 1, year: 2023 },
    { date: "2028-01-01", week: 52, year: 2027 },
    { date: "2028-01-03", week: 1, year: 2028 },
    { date: "2026-02-28", week: 9, year: 2026 },
    { date: "2024-02-29", week: 9, year: 2024 },
    { date: "2020-12-31", week: 53, year: 2020 },
  ])("$date → week $week, year $year", ({ date, week, year }) => {
    expect(isoWeek(d(date))).toEqual({ week, year });
  });
});

describe("isoWeekStart", () => {
  function fmt(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  it.each([
    { week: 1, year: 2026, expected: "2025-12-29" },
    { week: 21, year: 2026, expected: "2026-05-18" },
    { week: 53, year: 2026, expected: "2026-12-28" },
    { week: 1, year: 2025, expected: "2024-12-30" },
    { week: 1, year: 2024, expected: "2024-01-01" },
    { week: 1, year: 2023, expected: "2023-01-02" },
    { week: 52, year: 2022, expected: "2022-12-26" },
    { week: 9, year: 2026, expected: "2026-02-23" },
  ])("week $week of $year → Monday $expected", ({ week, year, expected }) => {
    const result = isoWeekStart(week, year);
    expect(fmt(result)).toBe(expected);
    expect(result.getDay()).toBe(1);
  });

  it("round-trips with isoWeek", () => {
    const cases = [
      { week: 1, year: 2026 },
      { week: 21, year: 2026 },
      { week: 52, year: 2024 },
      { week: 1, year: 2023 },
    ];
    for (const { week, year } of cases) {
      const monday = isoWeekStart(week, year);
      expect(isoWeek(monday)).toEqual({ week, year });
    }
  });
});
