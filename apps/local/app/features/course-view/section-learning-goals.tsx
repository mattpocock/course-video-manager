import { AlertTriangle, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { LEARNING_GOAL_WARNING_LABELS } from "@/services/beat-learning-goal-warnings";
import type { Section } from "./course-view-types";

/**
 * Same P1/P2/P3 palette as the Lesson priority filter buttons
 * (course-view-components.tsx) — one convention, read here rather than
 * re-derived, so a Learning Goal's priority reads the same as a Lesson's.
 */
const PRIORITY_BADGE_CLASS: Record<number, string> = {
  1: "bg-red-500/20 text-red-600",
  2: "bg-yellow-500/20 text-yellow-600",
  3: "bg-sky-500/20 text-sky-500",
};

function PriorityBadge({ priority }: { priority: number }) {
  const className =
    PRIORITY_BADGE_CLASS[priority] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-sm font-medium shrink-0",
        className
      )}
    >
      P{priority}
    </span>
  );
}

/**
 * A Section's Learning Goals — the pre-Beat planning artifact — shown as a
 * closed-by-default collapsible (mirrors publish-blockers.tsx's pattern: a
 * ChevronRight that rotates 90deg on open). `defaultOpen` lets a caller flip
 * that default: the section page opens it when the Section has no Lessons
 * yet, since the goals are all there is to look at at that point.
 *
 * Deliberately READ-ONLY: the `cvm learning-goal` CLI is the editing surface
 * (see CONTEXT.md / apps/local/app/cli/commands/learning-goal.ts). Renders
 * nothing when the Section has no Learning Goals yet.
 */
export function SectionLearningGoals({
  learningGoals,
  defaultOpen = false,
  showDescriptions = true,
}: {
  learningGoals: Section["learningGoals"];
  defaultOpen?: boolean;
  /** Course-view display setting for the Learning Goal Description note —
   * see `course-view-visibility.tsx`. Defaults to shown, matching today's
   * behaviour for any caller that doesn't pass it. */
  showDescriptions?: boolean;
}) {
  if (learningGoals.length === 0) {
    return null;
  }

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="border-b bg-muted/10 px-4 py-2"
    >
      <CollapsibleTrigger className="group flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full text-left">
        <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        Learning Goals
        <span className="text-muted-foreground/60">
          ({learningGoals.length})
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <ul className="space-y-2">
          {learningGoals.map((goal) => {
            const warnings = goal.warnings ?? [];
            return (
              <li key={goal.id} className="flex items-start gap-2 text-xs">
                <PriorityBadge priority={goal.priority} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground flex items-center gap-1">
                    {goal.title || "(untitled)"}
                    {warnings.length > 0 && (
                      <span
                        title={warnings
                          .map((w) => LEARNING_GOAL_WARNING_LABELS[w.kind])
                          .join("; ")}
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                      </span>
                    )}
                  </p>
                  {showDescriptions && goal.description && (
                    <p className="text-muted-foreground">{goal.description}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
