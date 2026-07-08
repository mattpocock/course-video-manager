import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { lessonSearchCmd } from "./search";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
  rejectBothFlags,
  withName,
} from "@/cli/helpers";
import { withBackupCoordination } from "@/cli/backup-coordinator";
import {
  LESSON_HELP,
  LIST_HELP,
  GET_HELP,
  TREE_HELP,
  CREATE_HELP,
  UPDATE_HELP,
  MOVE_HELP,
} from "./lesson.help";

/**
 * Refuse a write that targets a PUBLISHED (frozen) version.
 *
 * A course's Draft is simply its latest version (newest `createdAt`); every
 * older version is a frozen snapshot that Publish left behind, and mutating one
 * would silently corrupt history. Structural writes (`create`, `update`,
 * `move`) all gate on this so a stale id can never edit a snapshot. `repoId` +
 * `versionId` come off any lesson/section hierarchy (`repoVersion.repoId`,
 * `repoVersionId`). Rejection is invalid-input (exit 3), not not-found — the id
 * resolves fine, it just isn't editable.
 */
const assertDraftVersion = (coords: { repoId: string; versionId: string }) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const latest = yield* versionOps.getLatestCourseVersion(coords.repoId);
    if (!latest || latest.id !== coords.versionId) {
      return yield* parseError(
        "cannot edit a published version — edits go to the Draft " +
          "(the course's latest version)",
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

const section = Options.text("section");

const listCmd = Command.make("list", { section }, ({ section }) =>
  Effect.gen(function* () {
    const svc = yield* LessonSectionOperationsService;
    const rows = yield* svc.getLessonsBySectionId(section);
    yield* emitNdjson(rows.map(withName));
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

// ---------------------------------------------------------------------------
// get <id...>
// ---------------------------------------------------------------------------

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "lesson",
    ids,
    fetch: (id) =>
      Effect.flatMap(LessonSectionOperationsService, (svc) =>
        svc.getLessonWithHierarchyById(id).pipe(
          // Service throws the DOMAIN NotFoundError for an absent row; the CLI
          // owns not-found detection, so translate "absent" into undefined and
          // let emitGet emit the contract's {entity,id} NotFoundError + exit 2.
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
          // Archived lessons are deleted-equivalent (no flag, never visible):
          // treat an archived row as absent -> NotFoundError + exit 2.
          Effect.map((lesson) => (lesson?.archived ? undefined : lesson))
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// tree <id> [--depth N|all]
// ---------------------------------------------------------------------------

const treeId = Args.text({ name: "id" });
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
      .pipe(Effect.catchTag("NotFoundError", () => notFound("lesson", id)));

    // Archived lessons are deleted-equivalent: an archived lesson id is treated
    // as not found (no flag, never visible).
    if (lesson.archived) {
      return yield* notFound("lesson", id);
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

const createSection = Options.text("section").pipe(
  Options.withDescription("The Section id to create the lesson in (required).")
);
const createTitle = Options.text("title").pipe(
  Options.withDescription("The lesson title (also slugified into its path).")
);
const beforeOption = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this lesson id (mutually exclusive with --after)."
  ),
  Options.optional
);
const afterOption = Options.text("after").pipe(
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
    withBackupCoordination(
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
    )
).pipe(Command.withDescription(detail(CREATE_HELP)));

// ---------------------------------------------------------------------------
// update <id> --title <t>
// ---------------------------------------------------------------------------

const updateId = Args.text({ name: "id" });
const updateTitle = Options.text("title").pipe(
  Options.withDescription(
    "The lesson's new display title (the slug/path is left unchanged)."
  )
);

const updateCmd = Command.make(
  "update",
  { id: updateId, title: updateTitle },
  ({ id, title }) =>
    withBackupCoordination(
      Effect.gen(function* () {
        if (title.trim().length === 0) {
          return yield* parseError(
            "update needs a non-empty --title",
            "lesson"
          );
        }

        const svc = yield* LessonSectionOperationsService;

        const lesson = yield* svc
          .getLessonWithHierarchyById(id)
          .pipe(Effect.catchTag("NotFoundError", () => notFound("lesson", id)));
        if (lesson.archived) return yield* notFound("lesson", id);

        yield* assertDraftLesson(lesson);

        yield* svc.updateLesson(id, { title });

        const updated = yield* svc.getLessonWithHierarchyById(id);
        yield* emitObject(updated);
      })
    )
).pipe(Command.withDescription(detail(UPDATE_HELP)));

// ---------------------------------------------------------------------------
// move <id> [--section <id>] [--before|--after <lessonId>]
// ---------------------------------------------------------------------------

const moveId = Args.text({ name: "id" });
const moveSection = Options.text("section").pipe(
  Options.withDescription(
    "Destination Section id (omit to reorder within the current section)."
  ),
  Options.optional
);
const moveBefore = Options.text("before").pipe(
  Options.withDescription(
    "Place immediately before this lesson id (mutually exclusive with --after)."
  ),
  Options.optional
);
const moveAfter = Options.text("after").pipe(
  Options.withDescription(
    "Place immediately after this lesson id (mutually exclusive with --before)."
  ),
  Options.optional
);

const moveCmd = Command.make(
  "move",
  { id: moveId, section: moveSection, before: moveBefore, after: moveAfter },
  ({ id, section, before, after }) =>
    withBackupCoordination(
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
          .pipe(Effect.catchTag("NotFoundError", () => notFound("lesson", id)));
        if (lesson.archived) return yield* notFound("lesson", id);
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
          yield* writes.reorderLessons(currentSectionId, newOrderIds);
        } else {
          const targetLessons =
            yield* svc.getLessonsBySectionId(targetSectionId);
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
    )
).pipe(Command.withDescription(detail(MOVE_HELP)));

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
    lessonSearchCmd,
  ])
);
