import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  parseError,
  resolveVersionId,
  withName,
} from "@/cli/helpers";

/**
 * `cvm section` — read Sections of a Course Version.
 *
 * A Section is a directory-backed grouping of Lessons within a Course Version,
 * ordered by a fractional `order` (doublePrecision) index. Sections are
 * version-scoped: the same on-disk section appears once per Version, so every
 * read is anchored to a Version — by default the DRAFT Version (the single
 * mutable, latest-by-createdAt snapshot), or a pinned Published Version via
 * --course-version.
 *
 * A Section can be a GHOST Section (it exists in the database but not yet on the
 * file system) — its "real"-ness is derived from whether it contains at least
 * one real Lesson, never from its path. A section whose path ends in `ARCHIVE`
 * is an ARCHIVE Section (filtered out of the default course view in the app, but
 * still returned here unless it has been archived/deleted).
 */
const SECTION_HELP = `cvm section — Sections of a Course Version.

WHAT IS A SECTION
  A Section is a directory-backed grouping of Lessons inside a single Course
  Version, ordered by a fractional 'order' index. Sections are version-scoped:
  every read resolves a Version first (the DRAFT by default, or --course-version <id>
  to pin a Published Version snapshot).

  A GHOST Section exists in the database but not yet on disk; its real-ness is
  derived from containing at least one real Lesson, never from its path. Archived
  (deleted) sections are ALWAYS filtered out and are never visible — there is no
  --archived flag for sections.

OUTPUT FIELDS
  id            section id (use with 'get' / 'tree').
  path          the section's directory name / display name (e.g. "01-intro").
  order         fractional sort key within the Version (ascending).
  description   free-text section description (default "").
  repoVersionId the Course Version this section belongs to.
  archivedAt    deletion timestamp; always null in CLI output (archived hidden).
  lessons       (get only) the section's ACTIVE Lessons.

VERBS
  list   All sections of a Version (requires --course-version <id> or --course <id>).
  get    One or more sections by id (variadic), each with its active Lessons.
  tree   Skeleton of section -> lessons -> videos.

EXAMPLES
  # All sections of a course's Draft Version, mapping name -> id:
  cvm section list --course <courseId> | jq '{id, path}'

  # Sections of a pinned Published Version:
  cvm section list --course-version <versionId>

  # Inspect one section plus its lessons:
  cvm section get <sectionId>

  # Walk the structure, then drill into a lesson (flags come BEFORE the id):
  cvm section tree --depth all <sectionId> | jq '.children[].id'`;

const LIST_HELP = `List ALL Sections of one Course Version (the complete set, never a UI-bounded subset), as NDJSON — one compact JSON object per line, ordered by 'order' ascending. Each line carries the section's identity (id, name, path, order, repoVersionId), so an agent can map a section name to its id in a single call. 'name' is the uniform display label every noun's 'list' carries (for a section it mirrors 'path'), so you never have to guess the label field. Lessons are NOT included — list goes one level deep; use 'section get <id>' or 'lesson list --section <id>' to drill in.

You MUST scope the read to a Version:
  --course-version <id>   pin a specific Course Version (Draft or Published).
  --course <id>    resolve the course's DRAFT Version automatically.
Pass exactly one. Archived (deleted) sections are never included.

EXAMPLES
  cvm section list --course <courseId>
  cvm section list --course-version <versionId> | jq '{id, path}'`;

const GET_HELP = `Get one or more Sections BY ID (variadic). A single id prints one pretty JSON object; multiple ids print NDJSON (one compact object per line) of those found. Each section is returned with its parent context (its Course Version and Course) and its ACTIVE Lessons (the section's immediate natural children).

Not-found: a single missing id fails with NotFoundError on stderr (exit 2). With multiple ids, found sections are still emitted to stdout and the missing ids are reported on stderr (exit 2).

EXAMPLES
  cvm section get <sectionId>
  cvm section get <id1> <id2> <id3> | jq '{id, path}'`;

const TREE_HELP = `Print a SKELETON tree of a Section's structure: section -> lessons -> videos. Each node is minimal: { id, kind, name|title, children }. No full entity fields — use 'get' for those.

  kind "section"  -> name is the section path
  kind "lesson"   -> title is the lesson title (may be "")
  kind "video"    -> name is the video path

DEPTH
  --depth 1    (default) the section plus its direct children (lessons).
  --depth 2    also expand each lesson's videos.
  --depth all  the full subtree (section -> lessons -> videos).
Archived lessons and videos are excluded.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

EXAMPLES
  cvm section tree <sectionId>
  cvm section tree --depth all <sectionId> | jq '.children[] | {id, title}'`;

const ops = LessonSectionOperationsService;

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
                      name: v.path,
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
      name: section.path,
      children,
    });
  })
).pipe(Command.withDescription(detail(TREE_HELP)));

export const sectionCommand = Command.make("section").pipe(
  Command.withDescription(detail(SECTION_HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd.pipe(Command.withDescription(detail(GET_HELP))),
    treeCmd,
  ])
);
