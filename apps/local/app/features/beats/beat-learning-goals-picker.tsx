import { useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AlertTriangle, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BEAT_WARNING_LABELS,
  type BeatWarning,
} from "@/services/beat-learning-goal-warnings";

export interface BeatLearningGoalOption {
  id: string;
  title: string;
}

/**
 * A Beat's Learning Goal picker — a checkbox popover, scoped to the Beat's
 * own Section (options come from `SectionLearningGoals`, never cross-Section)
 * mirroring `DependencySelector`'s popover+checkbox shape but without its
 * search/drag/cycle machinery, which only make sense across a whole course's
 * Lessons. `onChange` always receives the FULL new set — there is no
 * incremental add/remove call, matching `setBeatLearningGoals`.
 */
export function BeatLearningGoalsPicker({
  selectedIds,
  options,
  onChange,
  warnings = [],
}: {
  selectedIds: readonly string[];
  options: readonly BeatLearningGoalOption[];
  onChange: (learningGoalIds: string[]) => void;
  warnings?: readonly BeatWarning[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const hasWarning = warnings.length > 0;
  const hasSelection = selectedIds.length > 0;
  const selectedTitles = selectedIds
    .map((id) => options.find((o) => o.id === id)?.title)
    .filter((title): title is string => Boolean(title));

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const title = hasWarning
    ? warnings.map((w) => BEAT_WARNING_LABELS[w.kind]).join("; ")
    : hasSelection
      ? `Serves: ${selectedTitles.join(", ")}`
      : "Set the Learning Goal(s) this Beat serves";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={buttonRef}
          className={cn(
            "text-xs flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted shrink-0 max-w-[12rem]",
            hasWarning
              ? "bg-amber-500/20 text-amber-600"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
          title={title}
        >
          {hasWarning ? (
            <AlertTriangle className="w-3 h-3 shrink-0" />
          ) : (
            <Target className="w-3 h-3 shrink-0" />
          )}
          {hasSelection && (
            <span className="truncate">{selectedTitles.join(", ")}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b">
          Learning Goals
        </div>
        <div
          className="overflow-y-auto p-1"
          style={{
            maxHeight: "var(--radix-popover-content-available-height, 300px)",
          }}
        >
          {options.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              This Section has no Learning Goals yet.
            </div>
          ) : (
            options.map((goal) => (
              <label
                key={goal.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.includes(goal.id)}
                  onCheckedChange={() => toggle(goal.id)}
                />
                <span className="truncate">{goal.title || "(untitled)"}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
