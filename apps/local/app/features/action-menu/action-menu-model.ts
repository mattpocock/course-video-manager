import type { LucideIcon } from "lucide-react";

/**
 * The kinds of group an action menu is made of, in the one order every menu
 * shows them (CODING_STANDARDS.md, "Action menus"). A caller says which kind
 * each action is; it never chooses where the action goes or draws a separator.
 *
 * - `open`   — go to it, view it, play it, reveal it.
 * - `edit`   — change this entity in place: rename, edit, set its status/kind.
 * - `create` — make a new thing beside or inside it: add, insert, duplicate.
 * - `move`   — reorder it or move it somewhere else.
 * - `run`    — produce something from it: export, render, transcribe, post.
 * - `copy`   — put something on the clipboard. An entity menu's Copy Link always
 *              closes this group.
 * - `danger` — archive, delete, remove. Always last, always red.
 */
export const ACTION_GROUPS = [
  "open",
  "edit",
  "create",
  "move",
  "run",
  "copy",
  "danger",
] as const;

export type ActionGroup = (typeof ACTION_GROUPS)[number];

/** One action. The icon is required: every item in an action menu has one. */
export interface ActionLeaf {
  /** Verb-first, Title Case, no trailing ellipsis — `opensDialog` adds it. */
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Applies to this entity but cannot run right now. Not for actions that never apply — leave those out. */
  disabled?: boolean;
  /** The action asks for more input (a dialog, a form) before it does anything. Renders a trailing "…". */
  opensDialog?: boolean;
  /** The key that runs this action outside the menu, shown right-aligned. */
  shortcut?: string;
  /** A muted second line under the label. */
  description?: string;
  /** Inside a submenu of states: marks the current one. */
  checked?: boolean;
}

/** One level of nesting, no deeper: a submenu's items are leaves. */
export interface ActionSubmenu {
  label: string;
  icon: LucideIcon;
  items: readonly MaybeItem<ActionLeaf>[];
}

/**
 * Folds related rare actions of one group into a submenu ("Copy ▸"), for a
 * menu past about eight entries. A group of one is no group: a lone present
 * action stays at the top level, and none at all leaves nothing.
 */
export function bundle(
  label: string,
  icon: LucideIcon,
  items: readonly MaybeItem<ActionLeaf>[]
): MaybeItem<ActionLeaf | ActionSubmenu> {
  const present = items.filter(isPresent);
  if (present.length <= 1) return present[0];
  return { label, icon, items: present };
}

/**
 * A value picker nested in an action menu — "Change Course" on a Course badge.
 * It opens as a submenu of radio options marking the current value. Its
 * options are values, not actions, so they are exempt from the action rules:
 * no icon, no Title Case, no group. Use it only where an action menu also
 * offers a choice of value; a menu that only picks a value is a picker, not an
 * action menu.
 */
export interface ActionPicker {
  /** Verb-first, Title Case, like any action: "Change Course". */
  label: string;
  icon: LucideIcon;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly PickerOption[];
}

export interface PickerOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Heads a run of options; each change of heading starts a new run. */
  heading?: string;
  /** A short code shown before the label, such as a priority ("P1"). */
  tag?: string;
}

export type ActionItem = ActionLeaf | ActionSubmenu | ActionPicker;

/** Lets a caller write `!isReadOnly && { … }` inside a group's list. */
type MaybeItem<T> = T | false | null | undefined;

export type ActionMenuGroups = Partial<
  Record<ActionGroup, readonly MaybeItem<ActionItem>[]>
>;

export interface LaidOutLeaf {
  kind: "leaf";
  key: string;
  /** The label as shown, ellipsis included. */
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled: boolean;
  destructive: boolean;
  shortcut: string | undefined;
  description: string | undefined;
  checked: boolean | undefined;
}

export interface LaidOutSubmenu {
  kind: "submenu";
  key: string;
  label: string;
  icon: LucideIcon;
  destructive: boolean;
  items: LaidOutLeaf[];
}

export interface LaidOutPicker extends Omit<ActionPicker, "options"> {
  kind: "picker";
  key: string;
  destructive: boolean;
  /** The options in runs, each under its heading (if any). */
  runs: { heading: string | undefined; options: PickerOption[] }[];
}

export interface LaidOutGroup {
  group: ActionGroup;
  items: (LaidOutLeaf | LaidOutSubmenu | LaidOutPicker)[];
}

const ELLIPSIS = "…";

function isPresent<T>(item: MaybeItem<T>): item is T {
  return item !== false && item !== null && item !== undefined;
}

function layoutLeaf(
  leaf: ActionLeaf,
  key: string,
  destructive: boolean
): LaidOutLeaf {
  return {
    kind: "leaf",
    key,
    label: leaf.opensDialog ? `${leaf.label}${ELLIPSIS}` : leaf.label,
    icon: leaf.icon,
    onSelect: leaf.onSelect,
    disabled: leaf.disabled ?? false,
    destructive,
    shortcut: leaf.shortcut,
    description: leaf.description,
    checked: leaf.checked,
  };
}

/**
 * Turns the caller's groups into what the menu renders: groups in canonical
 * order, empty ones dropped, `danger` items marked destructive, ellipses
 * added. `appendToCopy` closes the copy group (an entity menu's Copy Link). A separator goes between each pair of returned groups.
 */
export function layoutActionMenu(
  groups: ActionMenuGroups,
  appendToCopy: readonly ActionLeaf[] = []
): LaidOutGroup[] {
  return ACTION_GROUPS.flatMap((group): LaidOutGroup[] => {
    const destructive = group === "danger";
    const declared = (groups[group] ?? []).filter(isPresent);
    const all = group === "copy" ? [...declared, ...appendToCopy] : declared;
    const items = all.map(
      (item, i): LaidOutLeaf | LaidOutSubmenu | LaidOutPicker => {
        const key = `${group}-${i}-${item.label}`;
        if ("options" in item) {
          const { options, ...picker } = item;
          return {
            ...picker,
            kind: "picker",
            key,
            destructive,
            runs: toRuns(options),
          };
        }
        if ("items" in item) {
          return {
            kind: "submenu",
            key,
            label: item.label,
            icon: item.icon,
            destructive,
            items: item.items
              .filter(isPresent)
              .map((leaf, j) => layoutLeaf(leaf, `${key}-${j}`, destructive)),
          };
        }
        return layoutLeaf(item, key, destructive);
      }
    );
    return items.length > 0 ? [{ group, items }] : [];
  });
}

function toRuns(options: readonly PickerOption[]): LaidOutPicker["runs"] {
  const runs: LaidOutPicker["runs"] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last && last.heading === option.heading) last.options.push(option);
    else runs.push({ heading: option.heading, options: [option] });
  }
  return runs;
}

/** Words Title Case leaves lowercase unless they start or end the label. */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "via",
  "with",
]);

/**
 * What is wrong with a menu label, by the "Action menus" rules: Title Case,
 * no hand-written ellipsis, no stray whitespace. Empty when it is fine. Words
 * that are not plain words (`readme.md`, `{folder}/x`, `P1`) are left alone.
 */
export function labelProblems(label: string): string[] {
  const problems: string[] = [];
  if (label !== label.trim()) problems.push("has leading/trailing whitespace");
  if (/(\.\.\.|…)$/.test(label)) {
    problems.push("ends in an ellipsis — set opensDialog instead");
  }
  const words = label.trim().split(/\s+/);
  words.forEach((word, i) => {
    if (!/^[a-z][a-z'-]*$/.test(word)) return;
    const edge = i === 0 || i === words.length - 1;
    if (edge || !MINOR_WORDS.has(word)) {
      problems.push(`"${word}" should be capitalised (Title Case)`);
    }
  });
  return problems;
}
