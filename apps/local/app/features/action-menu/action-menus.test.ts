import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Link } from "lucide-react";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import { labelProblems, layoutActionMenu } from "./action-menu-model";

/**
 * The guard behind CODING_STANDARDS.md's "Action menus". Every action menu in
 * `app/` renders through `EntityMenuContent` (or `ActionMenuContent`, for a
 * menu not about an entity), which owns the order, the separators, the
 * destructive styling, the ellipsis and Copy Link. Hand-built menu
 * code — a raw `ContextMenuItem`, `DropdownMenuSeparator`… — fails outright
 * anywhere but a value picker (`PICKERS`). If a menu needs something the
 * model lacks, extend `action-menu-model.ts` (with a test) rather than build
 * the menu by hand.
 *
 * Submenus are one level deep (the model's types allow no more): a choice
 * among siblings, or a group's rare actions folded together once a menu
 * passes about eight entries. The video editor's Video menu, the longest in
 * the app, is held to that here.
 */

/**
 * Value pickers: they choose a value, they do not act on a thing. Exempt for
 * good. A choice *inside* an action menu (a Deliverable's Course) is not a
 * picker file: it is an `ActionPicker` item in that menu's groups.
 */
const PICKERS: Record<string, string> = {
  "components/effort-selector.tsx": "picks a Pitch's effort",
  "components/priority-selector.tsx": "picks a Pitch's priority",
  "features/article-writer/write-mode-dropdown.tsx": "picks the writer's mode",
  "features/deliverables-calendar/deliverable-form.tsx":
    "a multi-select picker inside the Deliverable form",
};

/**
 * Action menus that are not about an entity, so carry no Copy Link.
 * Only these files may use `ActionMenuContent`.
 */
const NOT_ENTITY_MENUS: Record<string, string> = {
  "features/beats/beat-list.tsx":
    "the Add Beat button picks the new Beat's kind; the Beat rows use EntityMenuContent",
  "features/article-writer/write-toolbar.tsx":
    "copies the writer's conversation or document text",
  "features/article-writer/document-panel.tsx":
    "copies or writes out the writer's document text",
  "features/deliverables-calendar/deliverable-card.tsx":
    "its date area's menu acts on a calendar day, not an entity",
  "features/deliverables-calendar/week-actions-menu.tsx":
    "acts on a calendar week, not an entity",
  "features/video-posting/skills-changelog-helpers.tsx":
    "an image-upload chooser",
  "routes/_app.storage.tsx":
    "acts on a Storage Bucket (a count of files, not an entity with a page link)",
  "routes/_app.storage_.$bucketId.tsx":
    "acts on one file on disk in a Storage Bucket, not an entity",
};

const APP_ROOT = join(import.meta.dirname, "..", "..");

/** Hand-built menu parts. The root and the Trigger stay raw; everything inside is the primitive's job. */
const RAW =
  /<(?:ContextMenu|DropdownMenu)(?:Content|Item|CheckboxItem|RadioItem|RadioGroup|Sub|SubTrigger|SubContent|Separator|Label|Group|Shortcut)\b/g;
const ENTITY_MENU = /<EntityMenuContent\b/g;
const ACTION_MENU = /<ActionMenuContent\b/g;
/** A label written as a string literal: `label: "…"`. */
const LITERAL_LABEL = /\blabel:\s*"([^"]*)"/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

const count = (source: string, pattern: RegExp) =>
  source.match(pattern)?.length ?? 0;

const files = tsxFiles(APP_ROOT)
  .map((path) => relative(APP_ROOT, path).split("\\").join("/"))
  // The shadcn primitives, and the action-menu primitive built on them.
  .filter((path) => !path.startsWith("components/ui/"))
  .filter((path) => !path.startsWith("features/action-menu/"))
  .map((path) => {
    const source = readFileSync(join(APP_ROOT, path), "utf8");
    return {
      path,
      source,
      raw: count(source, RAW),
      entityMenus: count(source, ENTITY_MENU),
      actionMenus: count(source, ACTION_MENU),
    };
  });

describe("action menus", () => {
  it("finds the app's menus (the scan is not silently empty)", () => {
    expect(
      files.filter((f) => f.raw + f.entityMenus + f.actionMenus > 0).length
    ).toBeGreaterThan(20);
  });

  it("builds no menu by hand", () => {
    const handBuilt = files
      .filter((f) => !(f.path in PICKERS))
      .filter((f) => f.raw > 0)
      .map((f) => `${f.path}: ${f.raw} raw menu parts`);
    expect(
      handBuilt,
      'Render these menus with <EntityMenuContent> (or <ActionMenuContent> for a menu not about an entity) from features/action-menu instead of raw ContextMenu*/DropdownMenu* parts — see CODING_STANDARDS.md, "Action menus"'
    ).toEqual([]);
  });

  it("uses ActionMenuContent only for menus that are not about an entity", () => {
    const misused = files
      .filter((f) => f.actionMenus > 0 && !(f.path in NOT_ENTITY_MENUS))
      .map((f) => f.path);
    expect(
      misused,
      "Use <EntityMenuContent entity={…}> so the menu can copy its link and ID, or add the file to NOT_ENTITY_MENUS with the reason"
    ).toEqual([]);
  });

  it("writes menu labels in Title Case, with no hand-written ellipsis", () => {
    const problems = files
      .filter((f) => f.entityMenus + f.actionMenus > 0)
      .flatMap((f) =>
        [...f.source.matchAll(LITERAL_LABEL)].flatMap(([, label]) =>
          labelProblems(label ?? "").map(
            (problem) => `${f.path}: "${label}" ${problem}`
          )
        )
      );
    expect(problems).toEqual([]);
  });

  it("lists no stale exemptions", () => {
    const menuPaths = files
      .filter((f) => f.raw + f.entityMenus + f.actionMenus > 0)
      .map((f) => f.path);
    const actionMenuPaths = files
      .filter((f) => f.actionMenus > 0)
      .map((f) => f.path);
    const stale = [
      ...Object.keys(PICKERS).filter((path) => !menuPaths.includes(path)),
      ...Object.keys(NOT_ENTITY_MENUS).filter(
        (path) => !actionMenuPaths.includes(path)
      ),
    ];
    expect(
      stale,
      "These files no longer open a picker / an ActionMenuContent; drop them"
    ).toEqual([]);
  });

  it("keeps the video editor's Video menu near eight entries, its rare actions folded into submenus", () => {
    const run = () => {};
    // Every action the landscape editor offers a lesson's exported Video.
    const groups = videoMenuGroups(
      {
        openTeleprompter: run,
        openDiagramPlayground: run,
        reference: { candidates: [{ id: "v2", title: "Other" }], open: run },
        revealInFileSystem: run,
        openInVSCode: run,
        rename: run,
        editLessonBody: run,
        autofillDescription: run,
        autofillChapters: run,
        addNote: run,
        duplicate: run,
        addVideoToLesson: run,
        createConcatenatedVideo: run,
        newShort: run,
        export: run,
        renderVerticalShort: run,
        retranscribeAllClips: run,
        copyTranscript: run,
        copyYouTubeChapters: run,
        copyLogPath: run,
      },
      { groupRareActions: true }
    );
    const copyLink = { label: "Copy Link", icon: Link, onSelect: run };
    const entries = layoutActionMenu(groups, [copyLink]).flatMap(
      (g) => g.items
    );
    // Folded into submenus by `bundle`, which never leaves a group of one.
    expect(entries.length).toBeLessThanOrEqual(10);
  });
});
