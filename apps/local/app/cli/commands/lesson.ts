import { Args, Command, Options } from "@effect/cli";
import { entityIdArg, entityIdOption } from "../entity-id";
import { explainStaleId, notFoundOrStale } from "../stale-id";
import { Effect, Option } from "effect";
import { lessonSearchCmd } from "./search";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { AUTHORING_STATUSES } from "@/services/lesson-authoring-status";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  fullOption,
  notFound,
  parseError,
  rejectBothFlags,
  withName,
} from "@/cli/helpers";
import {
  LESSON_HELP,
  LIST_HELP,
  GET_HELP,
  TREE_HELP,
  CREATE_HELP,
  UPDATE_HELP,
  MOVE_HELP,
  ARCHIVE_HELP,
  UNARCHIVE_HELP,
} from "./lesson.help";

/**
 * Refuse a write that targets a non-Draft (Pending/Published) version.
 *
 * The version's `commitState` is authoritative (no positional inference): only
 * a Draft accepts structural writes; a Pending or Published Version is an
 * immutable snapshot, and mutating one would silently corrupt history.
 * Structural writes (`create`, `update`, `move`) all gate on this so a stale
 * id can never edit a snapshot. (The DB-mutation layer enforces the same rule
 * with VersionNotDraftError; this pre-check just gives a friendlier exit-3
 * message.) Rejection is invalid-input (exit 3), not not-found — the id
 * resolves fine, it just isn't editable.
 */
const assertDraftVersion = (coords: { repoId: string; versionId: string }) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const version = yield* versionOps.getCourseVersionById(coords.versionId);
    if (version.commitState !== "draft") {
      return yield* parseError(
        "cannot edit a " +
          version.commitState +
          " version — edits go to the Draft",
        "lesson"
      );
    }
  });

/** Draft guard for a lesson resolved via `getLessonWithHierarchyById`. */
const assertDraftLesson = (lesson: {
  section: { repoVersionId: string; repoVersion: { repoId: string } };
}) =>
  assertDraftVersion({
    repoId: lesson.section.repoVersion.repoId,
    versionId: lesson.section.repoVersionId,
  });

// ---------------------------------------------------------------------------
// list --section <id>
// ---------------------------------------------------------------------------

const section = entityIdOption("section", "section");

const archived = Options.boolean("archived");

const listCmd = Command.make(
  "list",
  { section, archived },
  ({ section, archived }) =>
    Effect.gen(function* () {
      const svc = yield* LessonSectionOperationsService;
      const rows = archived
        ? yield* svc.getArchivedLessonsBySectionId(section)
        : yield* svc.getLessonsBySectionId(section);
      yield* emitNdjson(rows.map(withName));
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

// ---------------------------------------------------------------------------
// get <id...>
// ---------------------------------------------------------------------------

const ids = entityIdArg("lesson").pipe(Args.repeated);

const getCmd = Command.make("get", { ids, full: fullOption }, ({ ids, full }) =>
  emitGet({
    entity: "lesson",
    ids,
    includeMemory: full,
    explainMissing: explainStaleId("lesson"),
    fetch: (id) =>
      Effect.flatMap(LessonSectionOperationsService, (svc) =>
        svc.getLessonWithHierarchyById(id).pipe(
          // Service throws the DOMAIN NotFoundError for an absent row; the
          // CLI owns not-found detection, so translate "absent" into
          // undefined and let emitGet emit the contract's {entity,id}
          // NotFoundError + exit 2.
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
          // Archived lessons are deleted-equivalent (no flag, never
          // visible): treat an archived row as absent -> NotFoundError +
          // exit 2.
          Effect.map((lesson) => (lesson?.archived ? undefined : lesson))
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// tree <id> [--depth N|all]
// ---------------------------------------------------------------------------

const treeId = entityIdArg("lesson");
const depth = Options.text("depth").pipe(Options.withDefault("1"));

const parseDepth = (raw: string) =>
  Effect.gen(function* () {
    if (raw === "all") return Number.POSITIVE_INFINITY;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      return yield* parseError(
        `--depth must be a positive integer or "all" (got "${raw}")`,
        "lesson"
      );
    }
    return n;
  });

const treeCmd = Command.make("tree", { id: treeId, depth }, ({ id, depth }) =>
  Effect.gen(function* () {
    const maxDepth = yield* parseDepth(depth);
    const lessonSvc = yield* LessonSectionOperationsService;
    const videoSvc = yield* VideoOperationsService;

    // getLessonById returns the lesson WITH its (active) videos. It throws the
    // domain NotFoundError when absent — translate to the CLI's exit-2 shape.
    const lesson = yield* lessonSvc
      .getLessonById(id)
      .pipe(
        Effect.catchTag("NotFoundError", () => notFoundOrStale("lesson", id))
      );

    // Archived lessons are deleted-equivalent: an archived lesson id is treated
    // as not found (no flag, never visible).
    if (lesson.archived) {
      return yield* notFoundOrStale("lesson", id);
    }

    // getLessonById loads the lesson's videos relation WITHOUT an archived
    // filter; archived (deleted) lesson-bound videos are never visible, so drop
    // them before building the skeleton.
    const activeVideos = lesson.videos.filter((v) => !v.archived);

    const node: Record<string, unknown> = {
      id: lesson.id,
      kind: "lesson",
      title: lesson.title,
      path: lesson.title,
    };

    if (maxDepth >= 1) {
      const videoNodes = yield* Effect.forEach(
        activeVideos,
        (video) =>
          Effect.gen(function* () {
            const vNode: Record<string, unknown> = {
              id: video.id,
              kind: "video",
              title: video.title,
            };
            if (maxDepth >= 2) {
              const full = yield* videoSvc.getVideoWithClipsById(video.id);
              vNode.children = full.clips.map((clip) => ({
                id: clip.id,
                kind: "clip",
                videoFilename: clip.videoFilename,
                children: [],
              }));
            }
            return vNode;
          }),
        { concurrency: "unbounded" }
      );
      node.children = videoNodes;
    }

    yield* emitObject(node);
  })
).pipe(Command.withDescription(detail(TREE_HELP)));

// ---------------------------------------------------------------------------
// create --section <id> --title <t> [--before|--after <lessonId>]
// ---------------------------------------------------------------------------

const createSection = entityIdOption("section", "section").pipe(
  Options.withDescription("The Section id to create the lesson in (required).")
);
const createTitle = Options.text("title").pipe(
  Options.withDescription("The lesson title (also slugified into its path).")
);
const beforeOption = entityIdOption("before", "lesson").pipe(
  Options.withDescription(
    "Place immediately before this lesson id (mutually exclusive with --after)."
  ),
  Options.optional
);
const afterOption = entityIdOption("after", "lesson").pipe(
  Options.withDescription(
    "Place immediately after this lesson id (mutually exclusive with --before)."
  ),
  Options.optional
);

const createCmd = Command.make(
  "create",
  {
    section: createSection,
    title: createTitle,
    before: beforeOption,
    after: afterOption,
  },
  ({ section, title, before, after }) =>
    Effect.gen(function* () {
      const b = Option.getOrUndefined(before);
      const a = Option.getOrUndefined(after);
      yield* rejectBothFlags({
        a: b,
        b: a,
        flags: ["--before", "--after"],
        entity: "lesson",
      });

      const svc = yield* LessonSectionOperationsService;

      const targetSection = yield* svc
        .getSectionWithHierarchyById(section)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFound("section", section))
        );

      yield* assertDraftVersion({
        repoId: targetSection.repoVersion.repoId,
        versionId: targetSection.repoVersionId,
      });

      const siblings = yield* svc.getLessonsBySectionId(section);
      const maxOrder =
        siblings.length > 0 ? Math.max(...siblings.map((l) => l.order)) : 0;
      let insertOrder = maxOrder + 1;

      const anchorId = b ?? a;
      if (anchorId !== undefined) {
        const adjIdx = siblings.findIndex((l) => l.id === anchorId);
        if (adjIdx === -1) {
          return yield* notFound("lesson", anchorId);
        }
        const idx = a !== undefined ? adjIdx + 1 : adjIdx;
        yield* svc.batchUpdateLessonOrders(
          siblings.slice(idx).map((l) => ({ id: l.id, order: l.order + 1 }))
        );
        insertOrder = siblings[idx] ? siblings[idx]!.order : maxOrder + 1;
      }

      const [lesson] = yield* svc.createLesson(section, {
        title,
        order: insertOrder,
      });

      yield* emitObject(lesson);
    })
).pipe(Command.withDescription(detail(CREATE_HELP)));

// ---------------------------------------------------------------------------
// update <id> --title <t>
// ---------------------------------------------------------------------------

const updateId = entityIdArg("lesson");
const updateTitle = Options.text("title").pipe(
  Options.withDescription(
    "The lesson's new display title (the slug/path is left unchanged)."
  ),
  Options.optional
);
// The column is NOT NULL DEFAULT '', so there is no null to write back and no
// need for a --clear-description flag: `--description ""` IS the clear, and the
// reason this flag exists (a stale description you cannot otherwise blank from
// the CLI). Hence no non-empty guard here, unlike --title.
const updateDescription = Options.text("description").pipe(
  Options.withDescription(
    'The lesson\'s description (pass "" to clear a stale one).'
  ),
  Options.optional
);
const updateAuthoringStatus = Options.choice("authoring-status", [
  ...AUTHORING_STATUSES,
]).pipe(
  Options.withDescription(
    'Set the authoring status: "todo" (still needs work — the default for new ' +
      'lessons) or "done" (marked ready).'
  ),
  Options.optional
);
// Same name and parsing as `learning-goal --priority` (Options.integer), plus a
// range check: a Lesson Priority is P1/P2/P3 — the UI only writes 1, 2 or 3 and
// the Placeholder Floor only names those three — so anything else is refused
// rather than stored as a rank nothing else understands.
const LESSON_PRIORITIES = [1, 2, 3] as const;
const updatePriority = Options.integer("priority").pipe(
  Options.withDescription(
    "Set the Lesson Priority: 1, 2 (the default for new lessons) or 3; " +
      "lower is more important."
  ),
  Options.optional
);

const updateCmd = Command.make(
  "update",
  {
    id: updateId,
    title: updateTitle,
    description: updateDescription,
    authoringStatus: updateAuthoringStatus,
    priority: updatePriority,
  },
  ({ id, title, description, authoringStatus, priority }) =>
    Effect.gen(function* () {
      const titleValue = Option.getOrUndefined(title);
      const descriptionValue = Option.getOrUndefined(description);
      const statusValue = Option.getOrUndefined(authoringStatus);
      const priorityValue = Option.getOrUndefined(priority);

      if (
        titleValue === undefined &&
        descriptionValue === undefined &&
        statusValue === undefined &&
        priorityValue === undefined
      ) {
        return yield* parseError(
          "update needs at least one of --title, --description, --authoring-status or --priority",
          "lesson"
        );
      }
      if (
        priorityValue !== undefined &&
        !LESSON_PRIORITIES.some((p) => p === priorityValue)
      ) {
        return yield* parseError(
          `--priority must be 1, 2 or 3 (got ${priorityValue})`,
          "lesson"
        );
      }
      if (titleValue !== undefined && titleValue.trim().length === 0) {
        return yield* parseError("update needs a non-empty --title", "lesson");
      }

      const svc = yield* LessonSectionOperationsService;

      const lesson = yield* svc
        .getLessonWithHierarchyById(id)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFoundOrStale("lesson", id))
        );
      if (lesson.archived) return yield* notFoundOrStale("lesson", id);

      yield* assertDraftLesson(lesson);

      yield* svc.updateLesson(id, {
        ...(titleValue !== undefined ? { title: titleValue } : {}),
        ...(descriptionValue !== undefined
          ? { description: descriptionValue }
          : {}),
        ...(statusValue !== undefined ? { authoringStatus: statusValue } : {}),
        ...(priorityValue !== undefined ? { priority: priorityValue } : {}),
      });

      const updated = yield* svc.getLessonWithHierarchyById(id);
      yield* emitObject(updated);
    })
).pipe(Command.withDescription(detail(UPDATE_HELP)));

// ---------------------------------------------------------------------------
// move <id> [--section <id>] [--before|--after <lessonId>]
// ---------------------------------------------------------------------------

const moveId = entityIdArg("lesson");
const moveSection = entityIdOption("section", "section").pipe(
  Options.withDescription(
    "Destination Section id (omit to reorder within the current section)."
  ),
  Options.optional
);
const moveBefore = entityIdOption("before", "lesson").pipe(
  Options.withDescription(
    "Place immediately before this lesson id (mutually exclusive with --after)."
  ),
  Options.optional
);
const moveAfter = entityIdOption("after", "lesson").pipe(
  Options.withDescription(
    "Place immediately after this lesson id (mutually exclusive with --before)."
  ),
  Options.optional
);

const moveCmd = Command.make(
  "move",
  { id: moveId, section: moveSection, before: moveBefore, after: moveAfter },
  ({ id, section, before, after }) =>
    Effect.gen(function* () {
      const b = Option.getOrUndefined(before);
      const a = Option.getOrUndefined(after);
      yield* rejectBothFlags({
        a: b,
        b: a,
        flags: ["--before", "--after"],
        entity: "lesson",
      });
      const anchorId = b ?? a;

      const svc = yield* LessonSectionOperationsService;
      const writes = yield* CourseWriteService;

      const lesson = yield* svc
        .getLessonWithHierarchyById(id)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFoundOrStale("lesson", id))
        );
      if (lesson.archived) return yield* notFoundOrStale("lesson", id);
      yield* assertDraftLesson(lesson);

      if (anchorId === id) {
        return yield* parseError(
          "a lesson cannot be moved relative to itself",
          "lesson"
        );
      }

      const currentSectionId = lesson.sectionId;
      const targetSectionId =
        Option.getOrUndefined(section) ?? currentSectionId;

      if (targetSectionId !== currentSectionId) {
        const target = yield* svc
          .getSectionWithHierarchyById(targetSectionId)
          .pipe(
            Effect.catchTag("NotFoundError", () =>
              notFound("section", targetSectionId)
            )
          );
        if (
          target.archivedAt !== null ||
          target.repoVersionId !== lesson.section.repoVersionId
        ) {
          return yield* notFound("section", targetSectionId);
        }
      }

      if (targetSectionId === currentSectionId) {
        const siblings = yield* svc.getLessonsBySectionId(currentSectionId);
        const rest = siblings.filter((l) => l.id !== id);
        let insertAt = rest.length;
        if (anchorId !== undefined) {
          const idx = rest.findIndex((l) => l.id === anchorId);
          if (idx === -1) return yield* notFound("lesson", anchorId);
          insertAt = a !== undefined ? idx + 1 : idx;
        }
        const newOrderIds = [
          ...rest.slice(0, insertAt).map((l) => l.id),
          id,
          ...rest.slice(insertAt).map((l) => l.id),
        ];
        yield* svc.batchUpdateLessonOrders(
          newOrderIds.map((lessonId, order) => ({ id: lessonId, order }))
        );
      } else {
        const targetLessons = yield* svc.getLessonsBySectionId(targetSectionId);
        let beforeLessonId: string | null = null;
        if (anchorId !== undefined) {
          const idx = targetLessons.findIndex((l) => l.id === anchorId);
          if (idx === -1) return yield* notFound("lesson", anchorId);
          beforeLessonId =
            a !== undefined ? (targetLessons[idx + 1]?.id ?? null) : anchorId;
        }
        yield* writes.moveToSection(id, targetSectionId, beforeLessonId);
      }

      const moved = yield* svc.getLessonWithHierarchyById(id);
      yield* emitObject(moved);
    })
).pipe(Command.withDescription(detail(MOVE_HELP)));

// ---------------------------------------------------------------------------
// archive <id>
// ---------------------------------------------------------------------------

const archiveId = entityIdArg("lesson");

const archiveCmd = Command.make("archive", { id: archiveId }, ({ id }) =>
  Effect.gen(function* () {
    const svc = yield* LessonSectionOperationsService;

    // Read the row first — once archived it is deleted-equivalent, so this is
    // the last chance to fetch it (and the draft guard needs its hierarchy).
    const lesson = yield* svc
      .getLessonWithHierarchyById(id)
      .pipe(
        Effect.catchTag("NotFoundError", () => notFoundOrStale("lesson", id))
      );
    if (lesson.archived) return yield* notFoundOrStale("lesson", id);
    yield* assertDraftLesson(lesson);

    yield* svc.deleteLesson(id);

    // deleteLesson does not return the row (a plain UPDATE, no RETURNING), so
    // echo what we already read with the one field the write actually
    // changed — shaped the same way `get` would return it.
    yield* emitObject({ ...lesson, archived: true });
  })
).pipe(Command.withDescription(detail(ARCHIVE_HELP)));

// ---------------------------------------------------------------------------
// unarchive <id>
// ---------------------------------------------------------------------------

const unarchiveCmd = Command.make(
  "unarchive",
  { id: entityIdArg("lesson") },
  ({ id }) =>
    Effect.gen(function* () {
      const svc = yield* LessonSectionOperationsService;

      // Mirrors archive: unarchiving a live Lesson is invalid input.
      const lesson = yield* svc
        .getLessonWithHierarchyById(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("lesson", id)));
      if (!lesson.archived) {
        return yield* parseError(`lesson ${id} is not archived`, "lesson");
      }
      if (lesson.section.archivedAt !== null) {
        return yield* parseError(
          `lesson ${id} is in an archived section — there is nowhere to restore it to`,
          "lesson"
        );
      }
      yield* assertDraftLesson(lesson);

      yield* svc
        .unarchiveLesson(id)
        .pipe(
          Effect.catchTag("LessonPathTakenError", (e) =>
            parseError(e.message, "lesson")
          )
        );
      yield* emitObject(yield* svc.getLessonWithHierarchyById(id));
    })
).pipe(Command.withDescription(detail(UNARCHIVE_HELP)));

// ---------------------------------------------------------------------------
// lesson (parent)
// ---------------------------------------------------------------------------

export const lessonCommand = Command.make("lesson").pipe(
  Command.withDescription(detail(LESSON_HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    treeCmd,
    createCmd,
    updateCmd,
    moveCmd,
    archiveCmd,
    unarchiveCmd,
    lessonSearchCmd,
  ])
);
