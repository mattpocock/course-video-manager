import { isoWeek } from "./iso-week";

export type DeliverableStatus = "planned" | "done" | "cancelled";

export interface DeliverableForDisplay {
  date: string; // YYYY-MM-DD
  status: DeliverableStatus;
}

export type DeliverableBucket =
  | "history"
  | "overdue-in-week"
  | "this-week"
  | "future-week";

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function deliverableDisplay(
  d: DeliverableForDisplay,
  today: Date
): { bucket: DeliverableBucket; overdue: boolean } {
  const todayStr = formatDate(today);
  const isPast = d.date < todayStr;

  const todayWeek = isoWeek(today);
  const [y, m, day] = d.date.split("-").map(Number);
  const itemWeek = isoWeek(new Date(y!, m! - 1, day!));
  const isThisWeek =
    itemWeek.week === todayWeek.week && itemWeek.year === todayWeek.year;

  if (d.status === "planned" && isPast) {
    return { bucket: "overdue-in-week", overdue: true };
  }

  if (
    (d.status === "done" || d.status === "cancelled") &&
    isPast &&
    !isThisWeek
  ) {
    return { bucket: "history", overdue: false };
  }

  return { bucket: isThisWeek ? "this-week" : "future-week", overdue: false };
}
