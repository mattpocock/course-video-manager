// PROTOTYPE — Deliverables Calendar.
// Vertical agenda grouped by ISO week-of-year. Past-shipped/cancelled
// items collapse under a header at the top; everything from "this week"
// onward streams below. Overdue (planned + past) stays inline in red.
// Palette: neutral + red for overdue + a single foreground dot for "this week".
// See docs/adr/0007-deliverables-calendar-is-manual-and-informational.md.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  CheckIcon,
  XIcon,
  CircleIcon,
} from "lucide-react";

// ─── Mock data ───────────────────────────────────────────────────────────────

type DeliverableStatus = "planned" | "done" | "cancelled";

type Deliverable = {
  id: string;
  title: string;
  notes?: string;
  date: string; // YYYY-MM-DD
  status: DeliverableStatus;
  linkedCourses: string[];
  linkedPitches: string[];
};

const TODAY = "2026-05-18"; // Monday — ISO week 21

const DELIVERABLES: Deliverable[] = [
  {
    id: "d-04",
    title: "satisfies operator short",
    date: "2026-05-19",
    status: "planned",
    linkedCourses: [],
    linkedPitches: ["satisfies short"],
  },
  {
    id: "d-02",
    title: "Generics deep-dive video",
    date: "2026-05-21",
    status: "planned",
    linkedCourses: [],
    linkedPitches: ["Generics 101"],
  },
  {
    id: "d-03",
    title: "Newsletter: type predicates",
    date: "2026-05-21",
    status: "planned",
    linkedCourses: [],
    linkedPitches: ["Type predicates"],
  },
  {
    id: "d-05",
    title: "Effect course teaser",
    notes: "Coordinate with Effect team",
    date: "2026-05-26",
    status: "planned",
    linkedCourses: ["Effect for TS Devs"],
    linkedPitches: [],
  },
  {
    id: "d-11",
    title: "Why infer? short",
    date: "2026-05-28",
    status: "planned",
    linkedCourses: [],
    linkedPitches: ["Why infer"],
  },
  {
    id: "d-01",
    title: "Total TypeScript v3 launch",
    notes: "Hard date — partner promo locked",
    date: "2026-06-02",
    status: "planned",
    linkedCourses: ["Total TypeScript v3"],
    linkedPitches: [],
  },
  {
    id: "d-10",
    title: "Beginner TS module 2",
    date: "2026-06-09",
    status: "planned",
    linkedCourses: ["Beginner TS"],
    linkedPitches: [],
  },

  {
    id: "d-od1",
    title: "Conditional types explainer",
    notes: "Bumped twice — needs a real slot",
    date: "2026-05-16",
    status: "planned",
    linkedCourses: [],
    linkedPitches: ["Conditional types"],
  },
  {
    id: "d-od2",
    title: "Newsletter: tuple inference",
    date: "2026-05-10",
    status: "planned",
    linkedCourses: [],
    linkedPitches: ["Tuple inference"],
  },

  {
    id: "d-06",
    title: "Pitch: branded types video",
    date: "2026-05-14",
    status: "done",
    linkedCourses: [],
    linkedPitches: ["Branded types"],
  },
  {
    id: "d-07",
    title: "Discriminated unions livestream",
    date: "2026-05-08",
    status: "done",
    linkedCourses: [],
    linkedPitches: ["DU livestream"],
  },
  {
    id: "d-09",
    title: "Beginner TS module 1",
    date: "2026-05-05",
    status: "done",
    linkedCourses: ["Beginner TS"],
    linkedPitches: [],
  },

  {
    id: "d-08",
    title: "Conf talk dry run",
    date: "2026-05-12",
    status: "cancelled",
    linkedCourses: [],
    linkedPitches: [],
  },
  {
    id: "d-12",
    title: "react-query video",
    date: "2026-04-30",
    status: "cancelled",
    linkedCourses: [],
    linkedPitches: ["react-query"],
  },
];

// ─── Date helpers ────────────────────────────────────────────────────────────

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

// ISO week number (1–53). Week containing the year's first Thursday is week 1.
function isoWeek(d: Date): { week: number; year: number } {
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.getTime();
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const yearStartDay = (yearStart.getDay() + 6) % 7;
  if (yearStartDay <= 3) {
    yearStart.setDate(yearStart.getDate() - yearStartDay);
  } else {
    yearStart.setDate(yearStart.getDate() + (7 - yearStartDay));
  }
  const week =
    1 + Math.round((firstThursday - yearStart.getTime()) / 604_800_000);
  return { week, year: target.getFullYear() };
}

const TODAY_WEEK = isoWeek(parseDate(TODAY)).week;

// ─── Bits ────────────────────────────────────────────────────────────────────

function isOverdue(d: Deliverable): boolean {
  return d.status === "planned" && d.date < TODAY;
}

function LinkMeta({ d }: { d: Deliverable }) {
  if (!d.linkedCourses.length && !d.linkedPitches.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {[...d.linkedCourses, ...d.linkedPitches].map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="text-[10px] font-normal h-4 px-1.5 border-border text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}

function Row({ d }: { d: Deliverable }) {
  const day = parseDate(d.date);
  const overdue = isOverdue(d);
  const cancelled = d.status === "cancelled";
  const done = d.status === "done";
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md border p-2.5 bg-background",
        overdue ? "border-red-500/50 bg-red-500/5" : "border-border",
        cancelled && "opacity-50"
      )}
    >
      <div className="w-12 shrink-0 text-center">
        <div className="text-[10px] uppercase text-muted-foreground">
          {day.toLocaleDateString(undefined, { weekday: "short" })}
        </div>
        <div
          className={cn(
            "text-lg leading-none font-medium tabular-nums",
            overdue && "text-red-400"
          )}
        >
          {day.getDate()}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {overdue && (
            <AlertTriangleIcon className="size-3.5 text-red-400 shrink-0" />
          )}
          {done && (
            <CheckIcon className="size-3.5 text-muted-foreground shrink-0" />
          )}
          {cancelled && (
            <XIcon className="size-3.5 text-muted-foreground shrink-0" />
          )}
          <span
            className={cn(
              "text-sm",
              overdue && "text-red-200 font-medium",
              done && "text-muted-foreground",
              cancelled && "line-through text-muted-foreground"
            )}
          >
            {d.title}
          </span>
        </div>
        {d.notes && (
          <p className="text-xs text-muted-foreground mt-0.5">{d.notes}</p>
        )}
        <LinkMeta d={d} />
      </div>
    </li>
  );
}

// ─── Route ───────────────────────────────────────────────────────────────────

export default function PrototypeDeliverablesCalendar() {
  const [historyOpen, setHistoryOpen] = useState(false);

  // Past-shipped/cancelled is collapsed at the top.
  const past = DELIVERABLES.filter(
    (d) => d.date < TODAY && (d.status === "done" || d.status === "cancelled")
  ).sort((a, b) => b.date.localeCompare(a.date));

  // Everything else groups by ISO week: overdue planned + this-week-onward.
  const groupable = DELIVERABLES.filter(
    (d) =>
      !(d.date < TODAY && (d.status === "done" || d.status === "cancelled"))
  );

  type Group = { week: number; year: number; items: Deliverable[] };
  const byWeek = new Map<string, Group>();
  for (const d of [...groupable].sort((a, b) => a.date.localeCompare(b.date))) {
    const { week, year } = isoWeek(parseDate(d.date));
    const key = `${year}-${String(week).padStart(2, "0")}`;
    const g = byWeek.get(key) ?? { week, year, items: [] };
    g.items.push(d);
    byWeek.set(key, g);
  }
  const groups = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border px-6 py-3 flex items-baseline gap-3">
        <h1 className="text-sm font-semibold">Deliverables Calendar</h1>
        <span className="text-xs text-muted-foreground">
          today: {TODAY} · week {TODAY_WEEK} · mock data
        </span>
      </div>

      <div className="p-6 max-w-2xl mx-auto">
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="w-full text-left text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 py-2 border-b border-border"
        >
          {historyOpen ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
          {past.length} earlier — shipped &amp; cancelled
        </button>
        {historyOpen && (
          <ul className="space-y-1.5 mt-2 mb-2">
            {past.map((d) => (
              <Row key={d.id} d={d} />
            ))}
          </ul>
        )}

        <div className="space-y-5 mt-5">
          {groups.map(([key, g]) => {
            const isThisWeek = g.week === TODAY_WEEK;
            const isPastWeek = g.week < TODAY_WEEK;
            const overdueCount = g.items.filter(isOverdue).length;
            return (
              <section key={key}>
                <header
                  className={cn(
                    "flex items-center gap-3 mb-2",
                    isPastWeek && "text-muted-foreground"
                  )}
                >
                  {isThisWeek ? (
                    <CircleIcon className="size-2 fill-foreground text-foreground" />
                  ) : (
                    <span className="size-2 inline-block rounded-full border border-muted-foreground/40" />
                  )}
                  <h3
                    className={cn(
                      "text-[11px] uppercase tracking-wider font-medium",
                      isThisWeek && "text-foreground"
                    )}
                  >
                    Week {g.week}
                    {isThisWeek && " · this week"}
                  </h3>
                  {overdueCount > 0 && (
                    <span className="text-[10px] text-red-400">
                      {overdueCount} overdue
                    </span>
                  )}
                  <div
                    className={cn(
                      "h-px flex-1",
                      isThisWeek ? "bg-foreground/30" : "bg-border"
                    )}
                  />
                </header>
                <ul className="space-y-1.5">
                  {g.items.map((d) => (
                    <Row key={d.id} d={d} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
