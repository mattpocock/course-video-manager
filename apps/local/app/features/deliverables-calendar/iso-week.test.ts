import { describe, expect, it } from "vitest";
import { isoWeek } from "./iso-week";

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
