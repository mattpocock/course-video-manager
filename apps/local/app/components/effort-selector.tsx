import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type Effort = 1 | 2 | 3;

export const EFFORT_DOT_COLORS: Record<Effort, string> = {
  1: "bg-green-500",
  2: "bg-amber-500",
  3: "bg-red-500",
};

export const EFFORT_LABELS: Record<Effort, string> = {
  1: "Low",
  2: "Med",
  3: "High",
};

const EFFORT_MENU_LABELS: Record<Effort, string> = {
  1: "Low effort",
  2: "Medium effort",
  3: "High effort",
};

interface EffortSelectorProps {
  effort: Effort;
  onSelect?: (effort: Effort) => void;
  readOnly?: boolean;
}

export function EffortSelector({
  effort,
  onSelect,
  readOnly,
}: EffortSelectorProps) {
  const trigger = (
    <button
      type="button"
      className="flex-shrink-0 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm font-medium text-muted-foreground"
      title={readOnly ? EFFORT_LABELS[effort] : "Click to set effort"}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full",
          EFFORT_DOT_COLORS[effort]
        )}
      />
      {EFFORT_LABELS[effort]}
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
        {([1, 2, 3] as const).map((e) => (
          <DropdownMenuItem
            key={e}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(e);
            }}
            className={cn("text-xs font-medium", effort === e && "bg-accent")}
          >
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full mr-1",
                EFFORT_DOT_COLORS[e]
              )}
            />
            {EFFORT_MENU_LABELS[e]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
