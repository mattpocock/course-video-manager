import { useState } from "react";
import { useFetcher } from "react-router";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleDashedIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  PITCH_STATE_ORDER,
  PITCH_STATE_META,
} from "@/components/status-icon-badge";
import {
  CourseBadge,
  PitchBadge,
  PriorityPill,
  type LinkedCourse,
  type LinkedPitch,
} from "./deliverable-links";
import {
  DeliverableForm,
  type CourseOption,
  type PitchOption,
} from "./deliverable-form";

export interface DeliverableForCard {
  id: string;
  title: string;
  notes: string | null;
  date: string;
  status: "planned" | "done" | "cancelled";
  linkedCourses: LinkedCourse[];
  linkedPitches: LinkedPitch[];
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function CourseContextMenu({
  course,
  d,
  allCourses,
  submitLinkUpdate,
}: {
  course: LinkedCourse;
  d: DeliverableForCard;
  allCourses: CourseOption[];
  submitLinkUpdate: (courseIds: string[], pitchIds: string[]) => void;
}) {
  const pitchIds = d.linkedPitches.map((lp) => lp.id);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="cursor-context-menu">
        <CourseBadge course={course} />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 max-h-[min(20rem,var(--radix-context-menu-content-available-height))]">
        <ContextMenuLabel>Change course</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup
          value={course.id}
          onValueChange={(newId) => {
            submitLinkUpdate(
              d.linkedCourses.map((lc) =>
                lc.id === course.id ? newId : lc.id
              ),
              pitchIds
            );
          }}
        >
          {allCourses
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((co) => (
              <ContextMenuRadioItem
                key={co.id}
                value={co.id}
                disabled={
                  d.linkedCourses.some((lc) => lc.id === co.id) &&
                  co.id !== course.id
                }
              >
                {co.name}
              </ContextMenuRadioItem>
            ))}
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            submitLinkUpdate(
              d.linkedCourses
                .filter((lc) => lc.id !== course.id)
                .map((lc) => lc.id),
              pitchIds
            );
          }}
        >
          <Trash2Icon className="size-3.5" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PitchContextMenu({
  pitch,
  d,
  allPitches,
  submitLinkUpdate,
}: {
  pitch: LinkedPitch;
  d: DeliverableForCard;
  allPitches: PitchOption[];
  submitLinkUpdate: (courseIds: string[], pitchIds: string[]) => void;
}) {
  const courseIds = d.linkedCourses.map((lc) => lc.id);
  return (
    <ContextMenu>
      <ContextMenuTrigger className="cursor-context-menu">
        <PitchBadge pitch={pitch} />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-72 max-h-[min(20rem,var(--radix-context-menu-content-available-height))]">
        <ContextMenuLabel>Change pitch</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup
          value={pitch.id}
          onValueChange={(newId) => {
            submitLinkUpdate(
              courseIds,
              d.linkedPitches.map((lp) => (lp.id === pitch.id ? newId : lp.id))
            );
          }}
        >
          {PITCH_STATE_ORDER.flatMap((state) => {
            const inGroup = allPitches
              .filter((ap) => ap.state === state)
              .sort((a, b) =>
                a.priority !== b.priority
                  ? a.priority - b.priority
                  : a.title.localeCompare(b.title)
              );
            if (inGroup.length === 0) return [];
            const Icon = PITCH_STATE_META[state].icon;
            return [
              <ContextMenuLabel
                key={`label-${state}`}
                className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2"
              >
                <span className="flex items-center gap-1.5">
                  <Icon className="size-3" />
                  {PITCH_STATE_META[state].label}
                </span>
              </ContextMenuLabel>,
              ...inGroup.map((ap) => (
                <ContextMenuRadioItem
                  key={ap.id}
                  value={ap.id}
                  disabled={
                    d.linkedPitches.some((lp) => lp.id === ap.id) &&
                    ap.id !== pitch.id
                  }
                >
                  <span className="flex items-center gap-2">
                    <PriorityPill p={ap.priority} />
                    <span className="truncate">{ap.title}</span>
                  </span>
                </ContextMenuRadioItem>
              )),
            ];
          })}
        </ContextMenuRadioGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            submitLinkUpdate(
              courseIds,
              d.linkedPitches
                .filter((lp) => lp.id !== pitch.id)
                .map((lp) => lp.id)
            );
          }}
        >
          <Trash2Icon className="size-3.5" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function DeliverableCard({
  d,
  todayStr,
  overdueCutoffStr,
  allCourses,
  allPitches,
  onAddNewForDate,
}: {
  d: DeliverableForCard;
  todayStr: string;
  /** YYYY-MM-DD cutoff — items with date < this are treated as overdue. Defaults to todayStr. */
  overdueCutoffStr?: string;
  allCourses: CourseOption[];
  allPitches: PitchOption[];
  onAddNewForDate?: (dateStr: string) => void;
}) {
  overdueCutoffStr ??= todayStr;
  const [editing, setEditing] = useState(false);
  const linkFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const archiveFetcher = useFetcher();
  const duplicateFetcher = useFetcher();

  function submitLinkUpdate(courseIds: string[], pitchIds: string[]) {
    const fd = new FormData();
    fd.set("title", d.title);
    fd.set("date", d.date);
    fd.set("notes", d.notes ?? "");
    fd.set("status", d.status);
    for (const id of courseIds) fd.append("courseIds", id);
    for (const id of pitchIds) fd.append("pitchIds", id);
    linkFetcher.submit(fd, {
      method: "post",
      action: `/api/deliverables/${d.id}/update`,
    });
  }

  if (editing) {
    return (
      <li>
        <DeliverableForm
          d={d}
          onClose={() => setEditing(false)}
          allCourses={allCourses}
          allPitches={allPitches}
        />
      </li>
    );
  }

  const day = parseDate(d.date);
  const overdue = d.status === "planned" && d.date < overdueCutoffStr;
  const cancelled = d.status === "cancelled";
  const done = d.status === "done";

  const setStatus = (status: "planned" | "done" | "cancelled") => {
    const fd = new FormData();
    fd.set("status", status);
    statusFetcher.submit(fd, {
      method: "post",
      action: `/api/deliverables/${d.id}/update-status`,
    });
  };

  const duplicate = () => {
    duplicateFetcher.submit(new FormData(), {
      method: "post",
      action: `/api/deliverables/${d.id}/duplicate`,
    });
  };

  const dayLabel = `${day.toLocaleDateString(undefined, { weekday: "short" })} ${day.getDate()}`;

  const dateArea = (
    <div className="w-12 shrink-0 text-center">
      <div className="text-[10px] uppercase text-muted-foreground">
        {day.toLocaleDateString(undefined, { weekday: "short" })}
      </div>
      <div
        className={cn(
          "text-xl leading-none font-medium tabular-nums",
          overdue && "text-red-600 dark:text-red-400"
        )}
      >
        {day.getDate()}
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            "cursor-context-menu rounded-lg border bg-background p-3 flex items-start gap-3",
            overdue ? "border-red-500/50 bg-red-500/5" : "border-border",
            cancelled && "opacity-50"
          )}
        >
          {onAddNewForDate ? (
            <ContextMenu>
              <ContextMenuTrigger asChild>{dateArea}</ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onSelect={() => onAddNewForDate(d.date)}>
                  <PlusIcon className="size-3.5 mr-2" />
                  Add new for {dayLabel}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ) : (
            dateArea
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {overdue && (
                <AlertTriangleIcon className="size-3.5 text-red-600 dark:text-red-400 shrink-0" />
              )}
              {done && (
                <CheckIcon className="size-3.5 text-muted-foreground shrink-0" />
              )}
              {cancelled && (
                <XIcon className="size-3.5 text-muted-foreground shrink-0" />
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  done && "text-muted-foreground",
                  cancelled && "line-through text-muted-foreground"
                )}
              >
                {d.title}
              </span>
              {overdue && (
                <span className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">
                  · Overdue
                </span>
              )}
            </div>
            {d.notes && (
              <p className="text-xs text-muted-foreground mt-1">{d.notes}</p>
            )}
            {(d.linkedCourses.length > 0 || d.linkedPitches.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {d.linkedCourses.map((c) => (
                  <CourseContextMenu
                    key={c.id}
                    course={c}
                    d={d}
                    allCourses={allCourses}
                    submitLinkUpdate={submitLinkUpdate}
                  />
                ))}
                {d.linkedPitches.map((p) => (
                  <PitchContextMenu
                    key={p.id}
                    pitch={p}
                    d={d}
                    allPitches={allPitches}
                    submitLinkUpdate={submitLinkUpdate}
                  />
                ))}
              </div>
            )}
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => setEditing(true)}>
          <PencilIcon className="size-3.5 mr-2" />
          Edit…
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CircleDashedIcon className="size-3.5 mr-2" />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-40">
            <ContextMenuItem
              disabled={d.status === "planned"}
              onSelect={() => setStatus("planned")}
            >
              <CircleDashedIcon className="size-3.5 mr-2" />
              Planned
            </ContextMenuItem>
            <ContextMenuItem
              disabled={d.status === "done"}
              onSelect={() => setStatus("done")}
            >
              <CheckIcon className="size-3.5 mr-2" />
              Done
            </ContextMenuItem>
            <ContextMenuItem
              disabled={d.status === "cancelled"}
              onSelect={() => setStatus("cancelled")}
            >
              <XIcon className="size-3.5 mr-2" />
              Cancelled
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={duplicate}>
          <CopyIcon className="size-3.5 mr-2" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() =>
            archiveFetcher.submit(new FormData(), {
              method: "post",
              action: `/api/deliverables/${d.id}/archive`,
            })
          }
        >
          <Trash2Icon className="size-3.5 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
