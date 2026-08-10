import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type Priority = 1 | 2 | 3;

export const PRIORITY_STYLES: Record<Priority, string> = {
  1: "bg-red-500/20 text-red-600",
  2: "bg-yellow-500/20 text-yellow-600",
  3: "bg-sky-500/20 text-sky-500",
};

const PRIORITY_DOT_COLORS: Record<Priority, string> = {
  1: "bg-red-500",
  2: "bg-yellow-500",
  3: "bg-sky-500",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  1: "P1 — High",
  2: "P2 — Medium",
  3: "P3 — Low",
};

interface PrioritySelectorProps {
  priority: Priority;
  onSelect?: (priority: Priority) => void;
  readOnly?: boolean;
}

export function PrioritySelector({
  priority,
  onSelect,
  readOnly,
}: PrioritySelectorProps) {
  const trigger = (
    <button
      type="button"
      className={cn(
        "flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium",
        PRIORITY_STYLES[priority]
      )}
      title={readOnly ? `P${priority}` : "Click to set priority"}
      onClick={(e) => e.stopPropagation()}
    >
      P{priority}
    </button>
  );

  if (readOnly || !onSelect) {
    return trigger;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {([1, 2, 3] as const).map((p) => (
          <DropdownMenuItem
            key={p}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(p);
            }}
            className={cn("text-xs font-medium", priority === p && "bg-accent")}
          >
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full mr-1",
                PRIORITY_DOT_COLORS[p]
              )}
            />
            {PRIORITY_LABELS[p]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
