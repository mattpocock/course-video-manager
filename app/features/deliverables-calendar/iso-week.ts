export function isoWeekStart(week: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayNr = (jan4.getDay() + 6) % 7;
  const monday = new Date(year, 0, 4 - dayNr + (week - 1) * 7);
  return monday;
}

export function isoWeek(d: Date): { week: number; year: number } {
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const isoYear = target.getFullYear();
  const firstThursday = target.getTime();
  const yearStart = new Date(isoYear, 0, 1);
  const yearStartDay = (yearStart.getDay() + 6) % 7;
  if (yearStartDay <= 3) {
    yearStart.setDate(yearStart.getDate() - yearStartDay);
  } else {
    yearStart.setDate(yearStart.getDate() + (7 - yearStartDay));
  }
  const week =
    1 + Math.round((firstThursday - yearStart.getTime()) / 604_800_000);
  return { week, year: isoYear };
}
