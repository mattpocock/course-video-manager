import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { lessonSearchCmd } from "./search";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { toSlug } from "@/services/lesson-path-service";
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

/** Refuse a write that targets a PUBLISHED (frozen) version. */
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

/** `lesson` — the leaf authoring unit of a Course, inside a Section. */
const LESSON_HELP = `lesson — a Lesson: the leaf authoring unit inside a Section of a Course Version.

WHAT IT IS
  A Lesson belongs to one Section (sectionId) and contains Videos. Each Video is
  an ordered sequence of Clips. A lesson id is already version-scoped: every
  Course Version owns its own lesson rows (Publish copies structure forward), so
  there is no --course-version flag here — address the lesson you want by its id.

KEY FIELDS
  fsStatus         "real" (on disk) or "ghost" (DB only, not yet materialized).
  authoringStatus  "todo" | "done" for real lessons; null for ghosts.
  path             Slug (e.g. "01-intro"). Unique per section.
  title            Display title (may be empty for bare ghosts).
  order            Sort position within the section.
  priority         Authoring priority hint (integer, default 2).
  sectionId        Parent Section id.

ARCHIVED
  Archived lessons are deleted lessons: they are ALWAYS filtered out and never
  shown. There is no --archived flag for lessons.

VERBS
  list --section <id>   All active lessons in a Section (NDJSON, identity-rich).
  get <id...>           One or more lessons with their Section/Version/Repo
                        hierarchy. Variadic: many ids => NDJSON.
  tree <id> [--depth N] Skeleton tree lesson -> videos -> clips.
  create --section <id> --title <t> [--before|--after <lessonId>]
                        Create a GHOST lesson in a Section (WRITE).
  update <id> --title <t>
                        Rename a lesson's display title (WRITE; slug unchanged).
  move <id> [--section <id>] [--before|--after <lessonId>]
                        Reorder within a section, or re-home to another (WRITE).
  search <id> <query>   Substring search down this lesson's subtree
                        (--type lesson|video|beat).

WRITES honour DB↔disk correctness: reordering or moving a REAL (on-disk) lesson
renumbers folder prefixes and git-moves directories, so those verbs need the
course repo checked out. Writes only ever target the Draft (latest) version.

EXAMPLES
  cvm lesson list --section sec_123
  cvm lesson list --section sec_123 | jq 'select(.fsStatus=="ghost") | .id'
  cvm lesson get les_abc
  cvm lesson get les_abc les_def
  cvm lesson tree --depth all les_abc
  cvm lesson tree les_abc | jq '.children[].id'   # video ids, then: cvm video get <id>`;

const LIST_HELP = `List every ACTIVE lesson in a Section (the complete set, not a UI-bounded slice).

Requires --section <id>. Output is NDJSON, one compact lesson object per line,
ordered by the lesson's 'order'. Each line is identity-rich (id, name, title,
path, sectionId) plus fsStatus / authoringStatus. 'name' is the uniform display
label (title, falling back to path when empty). Archived lessons are never
included. Empty section => no output, exit 0.

Example:
  cvm lesson list --section sec_123
  cvm lesson list --section sec_123 | jq -c '{id, title, fsStatus, authoringStatus}'`;

const GET_HELP = `Fetch one or more Lessons by id, each with its parent hierarchy
(Section -> Course Version -> Repo).

Variadic. One id => pretty JSON. Multiple ids => NDJSON. Missing id => STDERR
NotFoundError + exit 2; found lessons still emitted to STDOUT first.

Examples:
  cvm lesson get les_abc
  cvm lesson get les_abc les_def les_ghi
  cvm lesson get les_abc | jq '{id, title, section: .section.path}'`;

const TREE_HELP = `Print a SKELETON tree for a Lesson: lesson -> videos -> clips.

Each node is {id, kind, title|path, children} only. 'kind' is "lesson" | "video"
| "clip". --depth N expands N levels (default 1 = videos only; 2+ adds clips;
"all" = full subtree). Options must come BEFORE the positional id.

Examples:
  cvm lesson tree les_abc
  cvm lesson tree --depth all les_abc
  cvm lesson tree --depth all les_abc | jq '.children[].children[].id'`;

const CREATE_HELP = `Create a GHOST lesson inside a Section. Requires --section <id> and --title <t>.

A ghost lesson is planned in the DB only (fsStatus="ghost"). It can still hold
Videos, Beats and Clips; materializing to disk is handled elsewhere. The 'path'
(slug) is derived from the title.

  --section <id>       (required) the Section to create the lesson in.
  --title <text>       (required) the lesson title (also slugified into 'path').
  --before <lessonId>  place before that lesson. --after <lessonId> after it.
                       (omit both to append to the end of the section.)

--before/--after are mutually exclusive. Slug collision => exit 3. Echoes the
created lesson as pretty JSON.

Examples:
  cvm lesson create --section sec_123 --title "Intro to Effect"
  cvm lesson create --section sec_123 --title "Setup" --before les_abc`;

const UPDATE_HELP = `Rename a lesson's display TITLE by id. Requires --title <t> (empty => exit 3).

Changes 'title' only — path/slug is left untouched so no URL or directory moves.
Published (frozen) versions are refused (exit 3); edits go to the Draft. Echoes
the updated lesson with hierarchy (as 'get').

Examples:
  cvm lesson update les_abc --title "A clearer title"`;

const MOVE_HELP = `Reposition a lesson: reorder within its Section, or re-home to another.

  cvm lesson move <id> [--section <id>] [--before|--after <lessonId>]

  --section <id>       destination Section (omit to stay in current section).
  --before/--after     place relative to that lesson (omit both to append).

--before/--after are mutually exclusive. Anchor must be a sibling (or in the
destination section). Published versions refused (exit 3). Moving a REAL
(on-disk) lesson git-moves directories; ghost lessons are a pure DB update.

Examples:
  cvm lesson move les_abc --before les_def
  cvm lesson move les_abc --section sec_9 --before les_ghi`;

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
      path: lesson.path,
    };

    if (maxDepth >= 1) {
      const videoNodes = yield* Effect.forEach(
        activeVideos,
        (video) =>
          Effect.gen(function* () {
            const vNode: Record<string, unknown> = {
              id: video.id,
              kind: "video",
              path: video.path,
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

      // Section must exist (clean exit 2 instead of an FK violation, exit 4).
      const targetSection = yield* svc
        .getSectionWithHierarchyById(section)
        .pipe(
          Effect.catchTag("NotFoundError", () => notFound("section", section))
        );

      // Writes only ever target the Draft — never a frozen published snapshot.
      yield* assertDraftVersion({
        repoId: targetSection.repoVersion.repoId,
        versionId: targetSection.repoVersionId,
      });

      const siblings = yield* svc.getLessonsBySectionId(section);
      const maxOrder =
        siblings.length > 0 ? Math.max(...siblings.map((l) => l.order)) : 0;
      let insertOrder = maxOrder + 1;

      // Resolve the --before/--after anchor into an insertion order, shifting
      // the siblings at/after the insertion point up by one to make room
      // (mirrors CourseWriteService.addGhostLesson).
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

      const [lesson] = yield* svc
        .createGhostLesson(section, {
          title,
          path: toSlug(title) || "untitled",
          order: insertOrder,
        })
        .pipe(
          // A slug collision with an existing lesson is invalid input (exit 3).
          Effect.catchTag("LessonPathTakenError", (e) =>
            parseError(e.message, "lesson")
          )
        );

      yield* emitObject(lesson);
    })
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
    Effect.gen(function* () {
      if (title.trim().length === 0) {
        return yield* parseError("update needs a non-empty --title", "lesson");
      }

      const svc = yield* LessonSectionOperationsService;

      // Resolve the lesson (with hierarchy for the Draft guard); archived and
      // absent both read as not-found (exit 2), matching `get`.
      const lesson = yield* svc
        .getLessonWithHierarchyById(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("lesson", id)));
      if (lesson.archived) return yield* notFound("lesson", id);

      yield* assertDraftLesson(lesson);

      // Title-only patch: no path change, so the per-section slug guard never
      // fires and no on-disk folder moves — a rename is a pure metadata write.
      yield* svc.updateLesson(id, { title });

      const updated = yield* svc.getLessonWithHierarchyById(id);
      yield* emitObject(updated);
    })
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

      // The lesson being moved must exist, be active, and live in the Draft.
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

      // Cross-section target must be active and in the same version.
      // Archived targets would slip past the move planner as no-ops.
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
        // -- Same-section reorder. planLessonMove no-ops a same-section move, so
        // reordering goes through reorderLessons with the full desired id list:
        // drop the lesson, reinsert it at the anchor (append when no anchor).
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
        // -- Cross-section move. moveToSection anchors on a `beforeLessonId`;
        // translate --after into "before the anchor's successor" (null = append).
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
