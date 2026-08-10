import { isoWeek } from "./iso-week";

export interface DeliverableForGrouping {
  id: string;
  title: string;
  notes: string | null;
  date: string; // YYYY-MM-DD
  status: "planned" | "done" | "cancelled";
  archived: boolean;
  createdAt: Date;
}

export interface WeekGroup<
  T extends DeliverableForGrouping = DeliverableForGrouping,
> {
  week: number;
  year: number;
  items: T[];
  overdueCount: number;
}

export interface GroupedDeliverables<
  T extends DeliverableForGrouping = DeliverableForGrouping,
> {
  pastHistory: T[];
  weekGroups: WeekGroup<T>[];
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupDeliverables<T extends DeliverableForGrouping>(
  deliverables: T[],
  today: Date,
  options: { minWeeksAhead?: number; overdueCutoffStr?: string } = {}
): GroupedDeliverables<T> {
  const active = deliverables.filter((d) => !d.archived);
  const todayStr = formatDate(today);
  const overdueCutoffStr = options.overdueCutoffStr ?? todayStr;
  const todayWeek = isoWeek(today);

  const pastHistory: T[] = [];
  const inline: T[] = [];

  for (const d of active) {
    const isPast = d.date < todayStr;
    if (isPast && (d.status === "done" || d.status === "cancelled")) {
      const itemWeek = isoWeek(parseDate(d.date));
      if (
        itemWeek.week === todayWeek.week &&
        itemWeek.year === todayWeek.year
      ) {
        inline.push(d);
      } else {
        pastHistory.push(d);
      }
    } else {
      inline.push(d);
    }
  }

  pastHistory.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const sorted = [...inline].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const weekKey = (w: number, y: number) =>
    `${y}-${String(w).padStart(2, "0")}`;

  const byWeek = new Map<string, WeekGroup<T>>();

  const todayKey = weekKey(todayWeek.week, todayWeek.year);
  byWeek.set(todayKey, {
    week: todayWeek.week,
    year: todayWeek.year,
    items: [] as T[],
    overdueCount: 0,
  });

  for (const d of sorted) {
    const { week, year } = isoWeek(parseDate(d.date));
    const key = weekKey(week, year);
    let group = byWeek.get(key);
    if (!group) {
      group = { week, year, items: [] as T[], overdueCount: 0 };
      byWeek.set(key, group);
    }
    group.items.push(d);
    if (d.status === "planned" && d.date < overdueCutoffStr) {
      group.overdueCount++;
    }
  }

  let maxWeekStart: Date | null = null;
  for (const d of sorted) {
    const dt = parseDate(d.date);
    const ws = mondayOf(dt);
    if (!maxWeekStart || ws.getTime() > maxWeekStart.getTime()) {
      maxWeekStart = ws;
    }
  }

  const todayWeekStart = mondayOf(today);
  const minWeeksAhead = options.minWeeksAhead ?? 0;
  const minFillEnd = new Date(todayWeekStart);
  minFillEnd.setDate(minFillEnd.getDate() + minWeeksAhead * 7);
  const fillUntil =
    maxWeekStart && maxWeekStart.getTime() > minFillEnd.getTime()
      ? maxWeekStart
      : minFillEnd;
  if (fillUntil.getTime() > todayWeekStart.getTime()) {
    const cursor = new Date(todayWeekStart);
    cursor.setDate(cursor.getDate() + 7);
    while (cursor.getTime() <= fillUntil.getTime()) {
      const { week, year } = isoWeek(cursor);
      const key = weekKey(week, year);
      if (!byWeek.has(key)) {
        byWeek.set(key, { week, year, items: [] as T[], overdueCount: 0 });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  const weekGroups = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => group);

  return { pastHistory, weekGroups };
}

function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - dayNr);
  return out;
}
