import { CalendarClock, CheckCircle2, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PitchState } from "@/services/db-pitch-operations.server";

export type { PitchState };

export const PITCH_STATE_ORDER: readonly PitchState[] = [
  "idle",
  "scheduled",
  "shipped",
] as const;

export const PITCH_STATE_META: Record<
  PitchState,
  {
    label: string;
    icon: typeof Lightbulb;
    iconWrap: string;
  }
> = {
  idle: {
    label: "Idle",
    icon: Lightbulb,
    iconWrap: "bg-muted text-muted-foreground",
  },
  scheduled: {
    label: "Scheduled",
    icon: CalendarClock,
    iconWrap: "bg-muted text-muted-foreground",
  },
  shipped: {
    label: "Shipped",
    icon: CheckCircle2,
    iconWrap: "bg-muted text-muted-foreground",
  },
};

export function PitchStateBadge({
  state,
  showLabel,
}: {
  state: PitchState;
  showLabel?: boolean;
}) {
  const m = PITCH_STATE_META[state];
  const Icon = m.icon;
  if (showLabel) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 h-6 pl-1 pr-2.5 rounded-full text-xs font-medium",
          m.iconWrap
        )}
        title={m.label}
      >
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full">
          <Icon className="w-3 h-3" />
        </span>
        {m.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-6 h-6 rounded-full",
        m.iconWrap
      )}
      title={m.label}
    >
      <Icon className="w-3 h-3" />
    </span>
  );
}
