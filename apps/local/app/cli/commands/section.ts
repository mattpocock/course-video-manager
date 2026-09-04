import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { sectionSearchCmd } from "./search";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
  resolveVersionId,
  withName,
} from "@/cli/helpers";
import {
  SECTION_HELP,
  LIST_HELP,
  GET_HELP,
  TREE_HELP,
  CREATE_HELP,
  RENAME_HELP,
  MOVE_HELP,
  ARCHIVE_HELP,
} from "./section.help";

/**
 * `cvm section` — Sections of a Course Version, now with write verbs.
 *
 * A Section is a grouping of Lessons within a Course Version, ordered by a
 * fractional `order` (doublePrecision) index. Sections are version-scoped: the
 * same section appears once per Version, so every read is anchored to a Version
 * — by default the DRAFT Version (the single mutable, latest-by-createdAt
 * snapshot), or a pinned Published Version via --course-version.
 *
 * An empty Section (one with no Lessons) has no derived numbered path — its path
 * falls back to its title — and is skipped from the numbered course view; it
 * gains a number once it contains at least one Lesson. A section whose path ends
 * in `ARCHIVE` is an ARCHIVE Section (filtered out of the default course view in
 * the app, but still returned here unless it has been archived/deleted). This is
 * an entirely different thing from this file's `archive` VERB below: the
 * `ARCHIVE`-suffix convention is a display filter in the app's UI that leaves
 * the section fully active and readable everywhere in this CLI, while `archive`
 * is a destructive, one-way soft-delete (sets `archivedAt`) — the same shape as
 * `cvm lesson archive`. See SECTION_HELP / ARCHIVE_HELP for the full contrast.
 *
 * `create`/`rename`/`archive` call LessonSectionOperationsService primitives
 * directly (not CourseWriteService) and do their own order math in the command
 * handler, the same way `cvm lesson create`/`archive` do. `move` instead
 * delegates its reorder to `CourseWriteService.reorderSections`, the same way
 * `cvm lesson move`'s within-section reorder delegates to
 * `CourseWriteService.reorderLessons` — a Section's only "parent" is the Course
 * Version itself, so `move` has no cross-parent re-homing case (no
 * `moveToSection` equivalent) the way `lesson move` does.
 */

const ops = LessonSectionOperationsService;

/**
 * Refuse a write that targets a non-Draft (Pending/Published) version.
 *
 * Mirrors lesson.ts's `assertDraftVersion`: the version's `commitState` is
 * authoritative, so a stale id can never edit a snapshot. Rejection is
 * invalid-input (exit 3), not not-found — the id resolves fine, it just isn't
 * editable. (The DB-mutation layer enforces the same rule with
 * VersionNotDraftError; this pre-check just gives a friendlier message.)
 */
const assertDraftVersion = (versionId: string) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const version = yield* versionOps.getCourseVersionById(versionId);
    if (version.commitState !== "draft") {
      return yield* parseError(
        "cannot edit a " +
          version.commitState +
          " version — edits go to the Draft",
        "section"
      );
    }
  });

/**
 * Resolve the repoVersionId for a version-scoped section read. Accepts either a
 * pinned --course-version or a --course (whose Draft Version is used). Exactly one must
 * be supplied; otherwise this fails with a ParseError (exit 3).
 */
const resolveScopedVersion = (
  version: Option.Option<string>,
  course: Option.Option<string>
) =>
  Effect.gen(function* () {
    const v = Option.getOrUndefined(version);
    const c = Option.getOrUndefined(course);
    if (v !== undefined) {
      // Validate the pinned version (courseId is unused when a pin is present).
      return yield* resolveVersionId({ courseId: c ?? v, version });
    }
    if (c !== undefined) {
      return yield* resolveVersionId({ courseId: c });
    }
    return yield* parseError(
      "section list requires --course-version <id> or --course <id>",
      "section"
    );
  });

const version = Options.text("course-version").pipe(Options.optional);
const course = Options.text("course").pipe(Options.optional);

const listCmd = Command.make(
  "list",
  { version, course },
  ({ version, course }) =>
    Effect.gen(function* () {
      const svc = yield* ops;
      const repoVersionId = yield* resolveScopedVersion(version, course);
      const sections = yield* svc.getSectionsByRepoVersionId(repoVersionId);
      yield* emitNdjson(sections.map(withName));
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "section",
    ids,
    fetch: (id) =>
      Effect.gen(function* () {
        const svc = yield* ops;
        const section = yield* svc
          .getSectionWithHierarchyById(id)
          .pipe(
            Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
          );
        // Sections have no viewable archive: an archived (archivedAt non-null)
        // section is treated as absent -> NotFoundError + exit 2.
        if (section === undefined || section.archivedAt !== null) {
          return undefined;
        }
        const lessons = yield* svc.getLessonsBySectionId(id);
        return { ...section, lessons };
      }),
  })
);

const depth = Options.text("depth").pipe(Options.withDefault("1"));
const treeId = Args.text({ name: "id" });

const treeCmd = Command.make("tree", { id: treeId, depth }, ({ id, depth }) =>
  Effect.gen(function* () {
    const maxDepth =
      depth === "all"
        ? Number.POSITIVE_INFINITY
        : Number.isInteger(Number(depth)) && Number(depth) >= 1
          ? Number(depth)
          : undefined;
    if (maxDepth === undefined) {
      return yield* parseError(
        `--depth must be a positive integer or "all" (got "${depth}")`,
        "section"
      );
    }

    const svc = yield* ops;
    const section = yield* svc
      .getSectionWithHierarchyById(id)
      .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)));
    if (section === undefined || section.archivedAt !== null) {
      // Archived (archivedAt non-null) sections are never viewable. Reuse
      // emitGet's single-id not-found semantics (stderr + exit 2).
      return yield* emitGet({
        entity: "section",
        ids: [id],
        fetch: () => Effect.succeed(undefined),
      });
    }

    const children =
      maxDepth >= 1
        ? yield* Effect.gen(function* () {
            const lessons = yield* svc.getLessonsBySectionId(id);
            return yield* Effect.forEach(lessons, (lesson) =>
              Effect.gen(function* () {
                let videoChildren: Array<{
                  id: string;
                  kind: "video";
                  name: string;
                  children: never[];
                }> = [];
                if (maxDepth >= 2) {
                  const full = yield* svc
                    .getLessonById(lesson.id)
                    .pipe(
                      Effect.catchTag("NotFoundError", () =>
                        Effect.succeed(undefined)
                      )
                    );
                  const videos = full?.videos ?? [];
                  videoChildren = videos
                    .filter((v) => !v.archived)
                    .map((v) => ({
                      id: v.id,
                      kind: "video" as const,
                      name: v.title,
                      children: [],
                    }));
                }
                return {
                  id: lesson.id,
                  kind: "lesson" as const,
                  title: lesson.title,
                  children: videoChildren,
                };
              })
            );
          })
        : [];

    yield* emitObject({
      id: section.id,
      kind: "section" as const,
      name: section.title,
      children,
    });
  })
).pipe(Command.withDescription(detail(TREE_HELP)));

// ---------------------------------------------------------------------------
// create --course-version <id>|--course <id> --title <t> [--before|--after <id>]
// ---------------------------------------------------------------------------

const createTitle = Options.text("title").pipe(
  Options.withDescription("The section title (also its display path).")
);
const createBefore = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this section id (mutually exclusive with --after)."
  ),
  Options.optional
);
const createAfter = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this section id (mutually exclusive with --before)."
  ),
  Options.optional
);

const createCmd = Command.make(
  "create",
  {
    version,
    course,
    title: createTitle,
    before: createBefore,
    after: createAfter,
  },
  ({ version, course, title, before, after }) =>
    Effect.gen(function* () {
      const b = Option.getOrUndefined(before);
      const a = Option.getOrUndefined(after);
      yield* rejectBothFlags({
        a: b,
        b: a,
        flags: ["--before", "--after"],
        entity: "section",
      });

      const repoVersionId = yield* resolveScopedVersion(version, course);
      yield* assertDraftVersion(repoVersionId);

      const svc = yield* ops;
      const siblings = yield* svc.getSectionsByRepoVersionId(repoVersionId);
      const maxOrder =
        siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) : 0;
      let insertOrder = maxOrder + 1;

      const anchorId = b ?? a;
      if (anchorId !== undefined) {
        const adjIdx = siblings.findIndex((s) => s.id === anchorId);
        if (adjIdx === -1) {
          return yield* notFound("section", anchorId);
        }
        const idx = a !== undefined ? adjIdx + 1 : adjIdx;
        yield* svc.batchUpdateSectionOrders(
          siblings.slice(idx).map((s) => ({ id: s.id, order: s.order + 1 }))
        );
        insertOrder = siblings[idx] ? siblings[idx]!.order : maxOrder + 1;
      }

      const [section] = yield* svc.createSections({
        repoVersionId,
        sections: [
          { sectionPathWithNumber: title, sectionNumber: insertOrder },
        ],
      });

      yield* emitObject(section);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));

// ---------------------------------------------------------------------------
// rename <id> --title <t>
// ---------------------------------------------------------------------------

const renameId = Args.text({ name: "id" });
const renameTitle = Options.text("title").pipe(
  Options.withDescription("The section's new display title.")
);

const renameCmd = Command.make(
  "rename",
  { id: renameId, title: renameTitle },
  ({ id, title }) =>
    Effect.gen(function* () {
      if (title.trim().length === 0) {
        return yield* parseError("rename needs a non-empty --title", "section");
      }

      const svc = yield* ops;
      const section = yield* svc
        .getSectionWithHierarchyById(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("section", id)));
      if (section.archivedAt !== null) return yield* notFound("section", id);

      yield* assertDraftVersion(section.repoVersionId);

      yield* svc.updateSectionTitle(id, title);

      const updated = yield* svc.getSectionWithHierarchyById(id);
      yield* emitObject(updated);
    })
).pipe(Command.withDescription(detail(RENAME_HELP)));

// ---------------------------------------------------------------------------
// move <id> [--before|--after <sectionId>]
// ---------------------------------------------------------------------------

const moveId = Args.text({ name: "id" });
const moveBefore = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this section id (mutually exclusive with --after)."
  ),
  Options.optional
);
const moveAfter = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this section id (mutually exclusive with --before)."
  ),
  Options.optional
);

const moveCmd = Command.make(
  "move",
  { id: moveId, before: moveBefore, after: moveAfter },
  ({ id, before, after }) =>
    Effect.gen(function* () {
      const b = Option.getOrUndefined(before);
      const a = Option.getOrUndefined(after);
      yield* rejectBothFlags({
        a: b,
        b: a,
        flags: ["--before", "--after"],
        entity: "section",
      });
      const anchorId = b ?? a;

      const svc = yield* ops;
      const writes = yield* CourseWriteService;
      const section = yield* svc
        .getSectionWithHierarchyById(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("section", id)));
      if (section.archivedAt !== null) return yield* notFound("section", id);
      yield* assertDraftVersion(section.repoVersionId);

      if (anchorId === id) {
        return yield* parseError(
          "a section cannot be moved relative to itself",
          "section"
        );
      }

      const siblings = yield* svc.getSectionsByRepoVersionId(
        section.repoVersionId
      );
      const rest = siblings.filter((sec) => sec.id !== id);
      let insertAt = rest.length;
      if (anchorId !== undefined) {
        const idx = rest.findIndex((sec) => sec.id === anchorId);
        if (idx === -1) return yield* notFound("section", anchorId);
        insertAt = a !== undefined ? idx + 1 : idx;
      }
      const newOrderIds = [
        ...rest.slice(0, insertAt).map((sec) => sec.id),
        id,
        ...rest.slice(insertAt).map((sec) => sec.id),
      ];
      yield* writes.reorderSections(newOrderIds);

      const moved = yield* svc.getSectionWithHierarchyById(id);
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

// ---------------------------------------------------------------------------
// archive <id>
// ---------------------------------------------------------------------------

const archiveId = Args.text({ name: "id" });

const archiveCmd = Command.make("archive", { id: archiveId }, ({ id }) =>
  Effect.gen(function* () {
    const svc = yield* ops;

    // Read the row first — once archived it is deleted-equivalent, so this is
    // the last chance to fetch it (and the draft guard needs its version id).
    const section = yield* svc
      .getSectionWithHierarchyById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("section", id)));
    if (section.archivedAt !== null) return yield* notFound("section", id);
    yield* assertDraftVersion(section.repoVersionId);

    const archivedAt = new Date();
    yield* svc.archiveSection(id);

    // archiveSection does not return the row (a plain UPDATE, no RETURNING), so
    // echo what we already read with the one field the write actually
    // changed — shaped the same way `get` would return it.
    yield* emitObject({ ...section, archivedAt });
  })
).pipe(Command.withDescription(detail(ARCHIVE_HELP)));

// ---------------------------------------------------------------------------
// section (parent)
// ---------------------------------------------------------------------------

export const sectionCommand = Command.make("section").pipe(
  Command.withDescription(detail(SECTION_HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd.pipe(Command.withDescription(detail(GET_HELP))),
    treeCmd,
    createCmd,
    renameCmd,
    moveCmd,
    archiveCmd,
    sectionSearchCmd,
  ])
);
