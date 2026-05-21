import { Link } from "react-router";
import { PRIORITY_STYLES, type Priority } from "@/components/priority-selector";
import { cn } from "@/lib/utils";

export interface LinkedCourse {
  id: string;
  name: string;
}

export interface LinkedPitch {
  id: string;
  title: string;
  priority: number;
}

export function courseHref(id: string) {
  return `/courses/${id}`;
}

export function pitchHref(id: string) {
  return `/pitches/${id}?from=deliverables`;
}

export function PriorityPill({ p }: { p: number }) {
  const priority = (p === 1 || p === 2 || p === 3 ? p : 3) as Priority;
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-1 text-[10px] font-medium tabular-nums",
        PRIORITY_STYLES[priority]
      )}
    >
      P{p}
    </span>
  );
}

export function CourseBadge({ course }: { course: LinkedCourse }) {
  return (
    <Link
      to={courseHref(course.id)}
      className="inline-flex items-center rounded-md bg-foreground/5 hover:bg-foreground/10 border border-border text-foreground/80 text-[11px] px-2 py-0.5"
    >
      {course.name}
    </Link>
  );
}

export function PitchBadge({ pitch }: { pitch: LinkedPitch }) {
  return (
    <Link
      to={pitchHref(pitch.id)}
      className="inline-flex items-center gap-1 rounded-md bg-foreground/5 hover:bg-foreground/10 border border-border text-[11px] px-2 py-0.5"
    >
      <PriorityPill p={pitch.priority} />
      {pitch.title}
    </Link>
  );
}
