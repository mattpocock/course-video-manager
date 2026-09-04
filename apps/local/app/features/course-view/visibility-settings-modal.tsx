import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  VISIBILITY_TREE,
  useCourseViewVisibility,
} from "./course-view-visibility";

/**
 * The "what's cluttering the course view right now" control: a dependency
 * checkbox tree (see `course-view-visibility.tsx`) rendered as a flat,
 * indented list — parents before their children, in the same order they
 * nest on screen. Unchecking a parent greys out (disables) its children
 * rather than clearing them, so re-checking it brings back whatever they
 * were set to. Saved to this browser via `CourseViewVisibilityProvider`, so
 * it follows Matt's phase of work rather than any one course.
 */
export function VisibilitySettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { prefs, effective, setPref } = useCourseViewVisibility();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Course view display</DialogTitle>
          <DialogDescription>
            Choose what's shown on the course view. Sections are always visible;
            everything else can be toggled off per phase of work. Applies to
            filters too — you can't filter on something that's hidden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-0.5 max-h-[60vh] overflow-y-auto -mx-1 px-1">
          <VisibilityRow label="Sections" checked disabled alwaysOn />
          {VISIBILITY_TREE.map((node) => {
            const parentOn = node.parent ? effective[node.parent] : true;
            return (
              <VisibilityRow
                key={node.key}
                label={node.label}
                checked={prefs[node.key]}
                disabled={!parentOn}
                indented={node.parent !== null}
                onCheckedChange={(checked) => setPref(node.key, checked)}
              />
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VisibilityRow({
  label,
  checked,
  disabled,
  indented,
  alwaysOn,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  indented?: boolean;
  alwaysOn?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const id = `course-view-visibility-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded px-1 py-1 text-sm",
        indented && "ml-6"
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange?.(value === true)}
      />
      <label
        htmlFor={id}
        className={cn(disabled ? "text-muted-foreground/50" : "cursor-pointer")}
      >
        {label}
      </label>
      {alwaysOn && (
        <span className="text-xs text-muted-foreground/60">
          (always visible)
        </span>
      )}
    </div>
  );
}
