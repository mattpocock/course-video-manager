import { useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  PriorityPill,
  type LinkedCourse,
  type LinkedPitch,
} from "./deliverable-links";
import {
  PITCH_STATE_ORDER,
  PITCH_STATE_META,
  type PitchState,
} from "@/components/status-icon-badge";

export interface DeliverableForForm {
  id: string;
  title: string;
  notes: string | null;
  date: string;
  status: "planned" | "done" | "cancelled";
  linkedCourses: LinkedCourse[];
  linkedPitches: LinkedPitch[];
}

export interface CourseOption {
  id: string;
  name: string;
}

export interface PitchOption {
  id: string;
  title: string;
  priority: number;
  state: PitchState;
}

type PickerEntry =
  | { id: string }
  | { groupLabel: React.ReactNode; key: string };

function CheckboxPicker({
  name,
  label,
  options,
  initial,
  renderOption,
  renderSelectedLabel,
}: {
  name: string;
  label: string;
  options: PickerEntry[];
  initial: string[];
  renderOption: (id: string) => React.ReactNode;
  renderSelectedLabel: (selectedIds: string[]) => string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="mt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-between"
            >
              <span className="truncate">
                {selected.size === 0
                  ? `Select ${label.toLowerCase()}…`
                  : renderSelectedLabel(Array.from(selected))}
              </span>
              <ChevronDownIcon className="size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-96 max-h-72 overflow-auto"
            align="start"
          >
            <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {options.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground italic">
                None available
              </div>
            )}
            {options.map((o) =>
              "groupLabel" in o ? (
                <DropdownMenuLabel
                  key={`g-${o.key}`}
                  className="text-[10px] uppercase tracking-wider text-muted-foreground pt-2"
                >
                  {o.groupLabel}
                </DropdownMenuLabel>
              ) : (
                <DropdownMenuCheckboxItem
                  key={o.id}
                  checked={selected.has(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {renderOption(o.id)}
                </DropdownMenuCheckboxItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
    </div>
  );
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DatePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Date"
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground"
          )}
        >
          {selected.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          <CalendarIcon className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(formatLocalDate(d));
              setOpen(false);
            }
          }}
          weekStartsOn={1}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export function DeliverableForm({
  d,
  initialDate,
  onClose,
  allCourses,
  allPitches,
}: {
  d?: DeliverableForForm;
  initialDate?: string;
  onClose: () => void;
  allCourses: CourseOption[];
  allPitches: PitchOption[];
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const isEdit = !!d;
  const action = isEdit
    ? `/api/deliverables/${d.id}/update`
    : "/api/deliverables/create";

  const sortedCourses = allCourses
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const todayStr = (() => {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const day = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const [dateStr, setDateStr] = useState<string>(
    d?.date ?? initialDate ?? todayStr
  );

  const groupedPitchEntries: PickerEntry[] = PITCH_STATE_ORDER.flatMap(
    (state) => {
      const inGroup = allPitches
        .filter((p) => p.state === state)
        .sort((a, b) =>
          a.priority !== b.priority
            ? a.priority - b.priority
            : a.title.localeCompare(b.title)
        );
      if (inGroup.length === 0) return [];
      const Icon = PITCH_STATE_META[state].icon;
      return [
        {
          key: state,
          groupLabel: (
            <span className="flex items-center gap-1.5">
              <Icon className="size-3" />
              {PITCH_STATE_META[state].label}
            </span>
          ),
        } as PickerEntry,
        ...inGroup.map((p) => ({ id: p.id })),
      ];
    }
  );
  const courseById = new Map(allCourses.map((c) => [c.id, c]));
  const pitchById = new Map(allPitches.map((p) => [p.id, p]));

  return (
    <fetcher.Form
      method="post"
      action={action}
      className="rounded-lg border border-foreground/20 p-4 bg-background space-y-3"
      onSubmit={() => setTimeout(() => onClose(), 0)}
    >
      <div className="grid grid-cols-2 gap-3">
        <input
          name="title"
          required
          defaultValue={d?.title}
          placeholder="Title"
          autoFocus
          aria-label="Title"
          className="col-span-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <DatePickerField value={dateStr} onChange={setDateStr} />
        <input type="hidden" name="date" value={dateStr} />
        <div />
        <textarea
          name="notes"
          rows={2}
          defaultValue={d?.notes ?? ""}
          placeholder="Notes (optional)"
          aria-label="Notes"
          className="col-span-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm resize-none"
        />
        {isEdit && <input type="hidden" name="status" value={d.status} />}
        <CheckboxPicker
          name="courseIds"
          label="Courses"
          options={sortedCourses.map((c) => ({ id: c.id }))}
          initial={d?.linkedCourses.map((c) => c.id) ?? []}
          renderOption={(id) => courseById.get(id)?.name ?? id}
          renderSelectedLabel={(ids) =>
            ids.length === 1
              ? (courseById.get(ids[0]!)?.name ?? ids[0]!)
              : `${ids.length} courses`
          }
        />
        <CheckboxPicker
          name="pitchIds"
          label="Pitches"
          options={groupedPitchEntries}
          initial={d?.linkedPitches.map((p) => p.id) ?? []}
          renderOption={(id) => {
            const p = pitchById.get(id);
            if (!p) return id;
            return (
              <span className="flex items-center gap-2">
                <PriorityPill p={p.priority} />
                <span className="truncate">{p.title}</span>
              </span>
            );
          }}
          renderSelectedLabel={(ids) =>
            ids.length === 1
              ? (pitchById.get(ids[0]!)?.title ?? ids[0]!)
              : `${ids.length} pitches`
          }
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : isEdit ? "Save" : "Create"}
        </Button>
      </div>
    </fetcher.Form>
  );
}
