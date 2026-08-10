import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DeliverableCard,
  type DeliverableForCard,
} from "@/features/deliverables-calendar/deliverable-card";
import {
  DeliverableForm,
  type CourseOption,
  type PitchOption,
} from "@/features/deliverables-calendar/deliverable-form";
import { WeekContextMenu } from "@/features/deliverables-calendar/week-actions-menu";
import {
  groupDeliverables,
  type DeliverableForGrouping,
} from "@/features/deliverables-calendar/deliverable-grouping";
import { isoWeek } from "@/features/deliverables-calendar/iso-week";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  Plus,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/_app._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Deliverables Calendar" }];
};

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const deliverableOps = yield* DeliverableOperationsService;
      const pitchOps = yield* PitchOperationsService;
      const [deliverables, courses, pitches] = yield* Effect.all(
        [
          deliverableOps.listDeliverables(),
          courseOps.getCourses(),
          pitchOps.listPitches(),
        ],
        { concurrency: "unbounded" }
      );

      const courseMap = new Map(courses.map((c) => [c.id, c.name]));
      const pitchMap = new Map(
        pitches.map((p) => [
          p.id,
          { title: p.title, priority: p.priority, state: p.state },
        ])
      );

      return {
        deliverables: deliverables.map((d) => ({
          id: d.id,
          title: d.title,
          notes: d.notes,
          date: d.date,
          status: d.status as "planned" | "done" | "cancelled",
          archived: d.archived,
          createdAt: d.createdAt.toISOString(),
          linkedCourses: d.deliverablesCourses.map((dc) => ({
            id: dc.courseId,
            name: courseMap.get(dc.courseId) ?? dc.courseId,
          })),
          linkedPitches: d.deliverablesPitches.map((dp) => {
            const p = pitchMap.get(dp.pitchId);
            return {
              id: dp.pitchId,
              title: p?.title ?? dp.pitchId,
              priority: p?.priority ?? 999,
            };
          }),
        })),
        courses: courses.map((c) => ({ id: c.id, name: c.name })),
        pitches: pitches.map((p) => ({
          id: p.id,
          title: p.title,
          priority: p.priority,
          state: p.state,
        })),
      };
    }),
});

type DeliverableWithLinks = DeliverableForGrouping & DeliverableForCard;

function isoWeekStart(week: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const dayNr = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(year, 0, 4 - dayNr);
  week1Monday.setDate(week1Monday.getDate() + (week - 1) * 7);
  return week1Monday;
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupByMonth(items: DeliverableWithLinks[]): {
  label: string;
  items: DeliverableWithLinks[];
}[] {
  const groups: { label: string; items: DeliverableWithLinks[] }[] = [];
  for (const d of items) {
    const [y, m] = d.date.split("-").map(Number);
    const date = new Date(y!, m! - 1, 1);
    const label = date.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(d);
    } else {
      groups.push({ label, items: [d] });
    }
  }
  return groups;
}

function HistoryDisclosure({
  items,
  todayStr,
  overdueCutoffStr,
  allCourses,
  allPitches,
}: {
  items: DeliverableWithLinks[];
  todayStr: string;
  overdueCutoffStr: string;
  allCourses: CourseOption[];
  allPitches: PitchOption[];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const monthGroups = groupByMonth(items);
  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 py-2 border-b border-border"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        {items.length} earlier — shipped &amp; cancelled
      </button>
      {open && (
        <div className="space-y-6 mt-2">
          {monthGroups.map((mg) => (
            <div key={mg.label}>
              <header className="flex items-center gap-3 mb-2">
                <span className="size-2 inline-block rounded-full border border-muted-foreground/40" />
                <h3 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                  {mg.label}
                </h3>
                <div className="h-px flex-1 bg-border" />
              </header>
              <ul className="space-y-2">
                {mg.items.map((d) => (
                  <DeliverableCard
                    key={d.id}
                    d={d}
                    todayStr={todayStr}
                    overdueCutoffStr={overdueCutoffStr}
                    allCourses={allCourses}
                    allPitches={allPitches}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BUFFER_STORAGE_KEY = "deliverables-calendar-overdue-buffer-weeks";
const BUFFER_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

function readBufferFromStorage(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(BUFFER_STORAGE_KEY);
  if (raw === null) return 0;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 8) return 0;
  return parsed;
}

export default function DeliverablesCalendarPage() {
  const { deliverables, courses, pitches } = useLoaderData<typeof loader>();
  const [createForm, setCreateForm] = useState<
    | { kind: "top" }
    | { kind: "week"; mondayStr: string }
    | { kind: "day"; mondayStr: string; dateStr: string }
    | null
  >(null);
  const [bufferWeeks, setBufferWeeks] = useState(0);

  useEffect(() => {
    setBufferWeeks(readBufferFromStorage());
  }, []);

  const handleBufferChange = (n: number) => {
    setBufferWeeks(n);
    if (typeof window !== "undefined") {
      localStorage.setItem(BUFFER_STORAGE_KEY, String(n));
    }
  };

  const today = new Date();
  const todayWeek = isoWeek(today);
  const todayStr = formatDateStr(today);

  const overdueCutoffDate = new Date(today);
  overdueCutoffDate.setDate(overdueCutoffDate.getDate() + bufferWeeks * 7);
  const overdueCutoffStr = formatDateStr(overdueCutoffDate);

  const deliverablesWithLinks: DeliverableWithLinks[] = deliverables.map(
    (d) => ({
      ...d,
      createdAt: new Date(d.createdAt),
    })
  );

  const { pastHistory, weekGroups } = groupDeliverables(
    deliverablesWithLinks,
    today,
    { minWeeksAhead: 11, overdueCutoffStr }
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div className="border-b border-border px-6 py-3 flex items-center gap-3">
          <h1 className="text-sm font-semibold">Deliverables Calendar</h1>
          <span className="text-xs text-muted-foreground">
            Week {todayWeek.week}
          </span>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Buffer:
            <select
              value={bufferWeeks}
              onChange={(e) => handleBufferChange(Number(e.target.value))}
              className="text-xs rounded border border-border bg-background px-1.5 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {BUFFER_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "week" : "weeks"}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCreateForm((v) => (v?.kind === "top" ? null : { kind: "top" }))
            }
          >
            <Plus className="size-3.5 mr-1.5" />
            New Deliverable
          </Button>
        </div>

        <div className="p-6 max-w-3xl mx-auto w-full">
          {createForm?.kind === "top" && (
            <div className="mb-5">
              <DeliverableForm
                onClose={() => setCreateForm(null)}
                allCourses={courses}
                allPitches={pitches}
              />
            </div>
          )}

          <HistoryDisclosure
            items={pastHistory}
            todayStr={todayStr}
            overdueCutoffStr={overdueCutoffStr}
            allCourses={courses}
            allPitches={pitches}
          />

          <div className="space-y-8">
            {weekGroups.map((g) => {
              const isThisWeek =
                g.week === todayWeek.week && g.year === todayWeek.year;
              const mondayStr = formatDateStr(isoWeekStart(g.week, g.year));
              const showWeekForm =
                (createForm?.kind === "week" &&
                  createForm.mondayStr === mondayStr) ||
                (createForm?.kind === "day" &&
                  createForm.mondayStr === mondayStr);
              const formInitialDate =
                createForm?.kind === "day" ? createForm.dateStr : mondayStr;
              return (
                <WeekContextMenu
                  key={`${g.year}-${g.week}`}
                  items={g.items}
                  onAddNew={() => setCreateForm({ kind: "week", mondayStr })}
                >
                  <section className="cursor-context-menu">
                    <header className="flex items-center gap-3 mb-2">
                      {isThisWeek ? (
                        <CircleIcon className="size-2 fill-foreground text-foreground" />
                      ) : (
                        <span className="size-2 inline-block rounded-full border border-muted-foreground/40" />
                      )}
                      <h3
                        className={cn(
                          "text-[11px] uppercase tracking-wider font-medium",
                          isThisWeek
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        Week {g.week}
                        {isThisWeek
                          ? " · this week"
                          : ` · ${isoWeekStart(
                              g.week,
                              g.year
                            ).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}`}
                      </h3>
                      {g.overdueCount > 0 && (
                        <span className="text-[10px] text-red-600 dark:text-red-400">
                          {g.overdueCount} overdue
                        </span>
                      )}
                      <div
                        className={cn(
                          "h-px flex-1",
                          isThisWeek ? "bg-foreground/30" : "bg-border"
                        )}
                      />
                    </header>
                    {showWeekForm && (
                      <div className="mb-2">
                        <DeliverableForm
                          initialDate={formInitialDate}
                          onClose={() => setCreateForm(null)}
                          allCourses={courses}
                          allPitches={pitches}
                        />
                      </div>
                    )}
                    {g.items.length > 0 ? (
                      <ul className="space-y-2">
                        {g.items.map((d) => (
                          <DeliverableCard
                            key={d.id}
                            d={d}
                            todayStr={todayStr}
                            overdueCutoffStr={overdueCutoffStr}
                            allCourses={courses}
                            allPitches={pitches}
                            onAddNewForDate={(dateStr) =>
                              setCreateForm({
                                kind: "day",
                                mondayStr,
                                dateStr,
                              })
                            }
                          />
                        ))}
                      </ul>
                    ) : (
                      !showWeekForm && (
                        <p className="text-xs text-muted-foreground italic pl-5">
                          No deliverables
                        </p>
                      )
                    )}
                  </section>
                </WeekContextMenu>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
