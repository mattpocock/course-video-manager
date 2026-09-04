import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";

/**
 * What can be individually shown or hidden on the course view. Deliberately
 * does NOT include "sections" — the Section is the one altitude that's
 * always on screen; every entity below it (Learning Goal, Lesson, Video,
 * Beat) plus the free-text description fields at each altitude are the
 * togglable surface. See CONTEXT.md's "Course structure" and "Video
 * planning" entries for what each of these names.
 */
export type VisibilityKey =
  | "sectionDescriptions"
  | "learningGoals"
  | "learningGoalDescriptions"
  | "lessons"
  | "lessonDescriptions"
  | "lessonPriorities"
  | "lessonTypes"
  | "todoMarkers"
  | "dependencies"
  | "videos"
  | "beats"
  | "beatDescriptions"
  | "addBeatButton";

export type VisibilityNode = {
  key: VisibilityKey;
  label: string;
  /** Effective visibility cascades: a node can only show if its parent does
   * too — see {@link resolveEffectiveVisibility}. `null` = top-level, gated
   * only by the always-on Section. */
  parent: VisibilityKey | null;
};

/**
 * The one place the checkbox tree's shape is declared — read by both the
 * settings modal (to render the list, parent before children) and
 * {@link resolveEffectiveVisibility} (to cascade). Mirrors the actual
 * nesting on screen: a Beat lives under a Video, a Video under a Lesson, a
 * Learning Goal Description under a Learning Goal.
 */
export const VISIBILITY_TREE: VisibilityNode[] = [
  { key: "sectionDescriptions", label: "Section descriptions", parent: null },
  { key: "learningGoals", label: "Learning goals", parent: null },
  {
    key: "learningGoalDescriptions",
    label: "Learning goal descriptions",
    parent: "learningGoals",
  },
  { key: "lessons", label: "Lessons", parent: null },
  {
    key: "lessonDescriptions",
    label: "Lesson descriptions",
    parent: "lessons",
  },
  { key: "lessonPriorities", label: "Lesson priorities", parent: "lessons" },
  { key: "lessonTypes", label: "Lesson types", parent: "lessons" },
  { key: "todoMarkers", label: "To-do markers", parent: "lessons" },
  { key: "dependencies", label: "Dependencies", parent: "lessons" },
  { key: "videos", label: "Videos", parent: "lessons" },
  { key: "beats", label: "Beats", parent: "videos" },
  { key: "beatDescriptions", label: "Beat descriptions", parent: "beats" },
  { key: "addBeatButton", label: "Add beat button", parent: "beats" },
];

/**
 * Defaults reproduce today's course view exactly, so shipping this feature
 * changes nothing until someone opens the settings modal. The one exception
 * is `beatDescriptions: false` — Beat Description is already deliberately
 * hidden on the course view (see CONTEXT.md's "Beat Description" entry;
 * previously enforced by `BeatDescriptionsContext` defaulting to `false`
 * with no provider on this route). Everything else is on today.
 */
export const DEFAULT_VISIBILITY: Record<VisibilityKey, boolean> = {
  sectionDescriptions: true,
  learningGoals: true,
  learningGoalDescriptions: true,
  lessons: true,
  lessonDescriptions: true,
  lessonPriorities: true,
  lessonTypes: true,
  todoMarkers: true,
  dependencies: true,
  videos: true,
  beats: true,
  beatDescriptions: false,
  addBeatButton: true,
};

const VISIBILITY_STORAGE_KEY = "course-view-visibility";

function parsePrefs(raw: string): Record<VisibilityKey, boolean> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_VISIBILITY;
    const source = parsed as Record<string, unknown>;
    const next = { ...DEFAULT_VISIBILITY };
    for (const node of VISIBILITY_TREE) {
      const value = source[node.key];
      if (typeof value === "boolean") next[node.key] = value;
    }
    return next;
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

/**
 * Turns each checkbox's own (stored) preference into what should actually
 * render, by ANDing it down through its ancestors: a child is only
 * effectively visible when it — and everything above it — is checked.
 * Unchecking a parent doesn't clear its children's stored preferences (so
 * re-checking the parent restores whatever the child was set to), it just
 * suppresses them until the parent is back on. This is the one function both
 * the modal (to grey out gated checkboxes) and every rendering call site (to
 * decide what to show) share, so the two can never disagree.
 */
export function resolveEffectiveVisibility(
  prefs: Record<VisibilityKey, boolean>
): Record<VisibilityKey, boolean> {
  const byKey = new Map(VISIBILITY_TREE.map((node) => [node.key, node]));
  const effective = {} as Record<VisibilityKey, boolean>;
  const resolve = (key: VisibilityKey): boolean => {
    if (key in effective) return effective[key]!;
    const node = byKey.get(key);
    const own = prefs[key] ?? true;
    const value = own && (node?.parent ? resolve(node.parent) : true);
    effective[key] = value;
    return value;
  };
  for (const node of VISIBILITY_TREE) resolve(node.key);
  return effective;
}

type VisibilityContextValue = {
  /** The raw, per-checkbox stored preference (what the modal shows as
   * checked/unchecked). */
  prefs: Record<VisibilityKey, boolean>;
  /** `prefs` cascaded through {@link resolveEffectiveVisibility} — what
   * every rendering call site should actually gate on. */
  effective: Record<VisibilityKey, boolean>;
  setPref: (key: VisibilityKey, value: boolean) => void;
};

/**
 * Everything visible, `setPref` a no-op — what any consumer sees with no
 * {@link CourseViewVisibilityProvider} above it. Mirrors the pattern in
 * `beat-descriptions-context.tsx`: a surface that never mounts the provider
 * (the Section Workbench, which already curates its own always-show view)
 * keeps behaving exactly as it does today.
 */
const CourseViewVisibilityContext = createContext<VisibilityContextValue>({
  prefs: DEFAULT_VISIBILITY,
  effective: DEFAULT_VISIBILITY,
  setPref: () => {},
});

/**
 * Owns the localStorage-backed visibility preferences for one browser (not
 * per-course — the whole point is a phase-of-work setting like "just beats
 * and learning goals", which travels with the person, not the course) and
 * makes them available to the whole course-view subtree via context, so
 * deeply-nested renderers (a Beat row, a Learning Goal line) can read it
 * without threading a prop through every intermediate component.
 */
export function CourseViewVisibilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [raw, setRaw] = useLocalStorage(
    VISIBILITY_STORAGE_KEY,
    JSON.stringify(DEFAULT_VISIBILITY)
  );
  const prefs = useMemo(() => parsePrefs(raw), [raw]);
  const effective = useMemo(() => resolveEffectiveVisibility(prefs), [prefs]);

  const setPref = (key: VisibilityKey, value: boolean) => {
    setRaw(JSON.stringify({ ...prefs, [key]: value }));
  };

  const value = useMemo(
    () => ({ prefs, effective, setPref }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs, effective]
  );

  return (
    <CourseViewVisibilityContext.Provider value={value}>
      {children}
    </CourseViewVisibilityContext.Provider>
  );
}

export function useCourseViewVisibility() {
  return useContext(CourseViewVisibilityContext);
}
