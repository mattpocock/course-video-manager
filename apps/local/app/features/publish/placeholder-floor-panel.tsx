import { AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { PRIORITY_STYLES, type Priority } from "@/components/priority-selector";
import { cn } from "@/lib/utils";
import {
  PLACEHOLDER_FLOOR_BANDS,
  type PlaceholderFloorBand,
} from "@/packages/course-json";
import {
  formatHardGaps,
  formatPublishSummary,
  PLACEHOLDER_FLOOR_BAND_DESCRIPTIONS,
  PLACEHOLDER_FLOOR_BAND_LABELS,
  WITHHELD_REASON_LABELS,
} from "./placeholder-floor";
import type {
  LessonPublishStatuses,
  PlaceholderLesson,
  WithheldLesson,
} from "@/services/course-publish-lesson-statuses";

/**
 * HOW FAR DOWN THE COURSE THIS RELEASE ANNOUNCES.
 *
 * The **Placeholder Floor**, beside the to-do toggle, with the whole
 * consequence of the choice under it: one summary line of the three **Lesson
 * Publish Status** counts, and two expandable cards naming the lessons behind
 * two of them. Moving the control moves lessons between the cards in front of
 * the author, because every position was classified before the page rendered.
 *
 * The withheld card is the safety net the feature rests on. A hard gap no
 * longer refuses a publish, so that list is the only thing standing between the
 * author and a lesson quietly missing from a release — which is why it names a
 * reason per lesson rather than merely counting them.
 */
export function PlaceholderFloorPanel({
  band,
  onBandChange,
  disabled,
  statuses,
}: {
  band: PlaceholderFloorBand;
  onBandChange: (band: PlaceholderFloorBand) => void;
  disabled: boolean;
  statuses: LessonPublishStatuses;
}) {
  const { ships, placeholderLessons, withheldLessons } = statuses;

  return (
    <div className="mb-8 rounded-lg border border-border p-4 space-y-3">
      <div className="space-y-2">
        <Label className="font-medium">Announce lessons down to</Label>
        <div className="flex gap-1">
          {PLACEHOLDER_FLOOR_BANDS.map((position) => (
            <Button
              key={position}
              variant={band === position ? "default" : "outline"}
              size="sm"
              onClick={() => onBandChange(position)}
              disabled={disabled}
            >
              {PLACEHOLDER_FLOOR_BAND_LABELS[position]}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {PLACEHOLDER_FLOOR_BAND_DESCRIPTIONS[band]}
        </p>
      </div>

      <p className="text-sm font-mono">
        {formatPublishSummary({
          ships,
          placeholders: placeholderLessons.length,
          withheld: withheldLessons.length,
        })}
      </p>

      {placeholderLessons.length > 0 && (
        <FloorCard
          heading={`Shipping as Placeholders — ${placeholderLessons.length} lesson${
            placeholderLessons.length !== 1 ? "s" : ""
          }`}
        >
          {placeholderLessons.map((lesson) => (
            <PlaceholderRow key={rowKey(lesson)} lesson={lesson} />
          ))}
        </FloorCard>
      )}

      {withheldLessons.length > 0 && (
        <FloorCard
          heading={`Withheld — not shippable — ${withheldLessons.length} lesson${
            withheldLessons.length !== 1 ? "s" : ""
          }`}
          warn
        >
          {withheldLessons.map((lesson) => (
            <WithheldRow key={rowKey(lesson)} lesson={lesson} />
          ))}
        </FloorCard>
      )}
    </div>
  );
}

const rowKey = (lesson: PlaceholderLesson) =>
  `${lesson.sectionPath}/${lesson.lessonPath}`;

/**
 * The expandable warning card, as the blocker lists already draw it. `warn`
 * tints the withheld card, because an absent lesson is the thing an author must
 * not walk past.
 */
function FloorCard({
  heading,
  warn,
  children,
}: {
  heading: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible className="rounded-lg border border-border p-4">
      <CollapsibleTrigger
        className={cn(
          "group flex items-center gap-2 text-sm w-full text-left",
          warn
            ? "text-amber-500 hover:text-amber-400"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <ChevronRight className="w-4 h-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        {warn && <AlertTriangle className="w-4 h-4 shrink-0" />}
        {heading}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <ul className="space-y-1.5">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PlaceholderRow({ lesson }: { lesson: PlaceholderLesson }) {
  return (
    <li className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {lesson.title || lesson.lessonPath}
      </span>{" "}
      <PriorityBadge priority={lesson.priority} />
      <span className="block text-muted-foreground/70">
        {lesson.sectionPath} / {lesson.lessonPath}
      </span>
    </li>
  );
}

/**
 * The reason AND the gaps. A `todo` reason takes precedence over a hard gap in
 * the verdict itself (`collectPublishBlockers` depends on that order), so the
 * label alone can tell an author to flip a toggle that will not help. The gaps
 * ride alongside it, unconditionally, so a Lesson never looks fixable when it
 * is not.
 */
function WithheldRow({ lesson }: { lesson: WithheldLesson }) {
  const gaps = formatHardGaps(lesson.hardGaps);
  return (
    <li className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        {lesson.title || lesson.lessonPath}
      </span>{" "}
      <PriorityBadge priority={lesson.priority} />{" "}
      <span className="text-amber-500">
        ({WITHHELD_REASON_LABELS[lesson.reason]})
      </span>
      {gaps !== null && (
        <span className="block text-amber-500/80">gaps: {gaps}</span>
      )}
      <span className="block text-muted-foreground/70">
        {lesson.sectionPath} / {lesson.lessonPath}
      </span>
    </li>
  );
}

/**
 * `lessons.priority` is a plain integer with no check constraint, so a band
 * outside 1–3 gets the neutral style rather than no badge — the number is still
 * what the floor compares against.
 */
function PriorityBadge({ priority }: { priority: number }) {
  const style = PRIORITY_STYLES[priority as Priority];
  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 font-medium",
        style ?? "bg-muted text-muted-foreground"
      )}
    >
      P{priority}
    </span>
  );
}
