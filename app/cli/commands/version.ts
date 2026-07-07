import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "@/cli/helpers";

/**
 * `cvm version` — read CourseVersions, the immutable/draft SNAPSHOTS of a
 * Course's section/lesson/video structure.
 *
 * Ubiquitous language (see CONTEXT.md, keep in sync by hand):
 *   - A CourseVersion is a snapshot of a Course's structure at a point in time.
 *   - The DRAFT VERSION is the single mutable version currently being edited;
 *     it is always the latest by createdAt and has an empty name/description.
 *   - A PUBLISHED VERSION is immutable, carries a name + description (set by the
 *     Publish flow), and cannot be deleted.
 * Versions are top-level here: address them by id, list them per-course.
 */
const VERSION_HELP = `Read CourseVersions — the snapshots of a Course's section/lesson/video structure.

A CourseVersion is a frozen (or in-progress) capture of a whole Course tree. Each
Course has exactly one DRAFT VERSION (the latest by createdAt — mutable, empty
name/description) plus zero or more PUBLISHED VERSIONS (immutable, named, created
by Publish, never deletable). "Version-scoped" reads elsewhere in cvm default to
the Draft; here you read the version rows themselves.

OUTPUT FIELDS
  id           CourseVersion id (use this to pin --course-version on other nouns).
  repoId       id of the owning Course (the "course id").
  name         Empty "" for the Draft Version; the publish name otherwise.
  description  Empty "" for the Draft Version; the publish description otherwise.
  createdAt    When the version was created (latest = Draft).
  isDraft      true for the single Draft Version of the course (list only).

VERBS
  list --course <courseId>     All versions of a course, newest first (NDJSON).
  get <id...>                  One or more versions by id (+ shallow sections).
  tree [--depth N|all] <id>    Version -> sections -> lessons -> videos skeleton.

NOTE ON FLAG ORDER
  Options must come BEFORE positional ids (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

EXAMPLES
  cvm version list --course course_123
  cvm version list --course course_123 | jq 'select(.isDraft) | .id'
  cvm version get ver_abc ver_def
  cvm version tree --depth all ver_abc
  # Find the draft, then walk its tree:
  V=$(cvm version list --course course_123 | jq -r 'select(.isDraft).id')
  cvm version tree --depth 2 "$V"`;

const LIST_HELP = `List every CourseVersion of a course, newest first (the first row is the Draft).

Requires --course <courseId>. Output is NDJSON (one compact version object per
line), identity-rich so you can map a publish name -> version id in one call.
Each row carries an extra isDraft flag (true for the single latest version).
A course with no versions prints nothing and exits 0.

EXAMPLES
  cvm version list --course course_123
  cvm version list --course course_123 | jq -r '[.id, .name] | @tsv'`;

const GET_HELP = `Fetch one or more CourseVersions by id (variadic, ids only).

Shallow + fixed depth: each result is the version row plus its IMMEDIATE children
— the version's Sections (id, path, order, description) — but NOT the lessons or
videos inside them (use 'tree' to descend). One id => one pretty JSON object;
multiple ids => NDJSON of the found versions, with any missing ids reported on
stderr and exit code 2.

EXAMPLES
  cvm version get ver_abc
  cvm version get ver_abc ver_def | jq '.sections | length'`;

const TREE_HELP = `Print the SKELETON of a CourseVersion: version -> sections -> lessons -> videos.

Each node is {id, kind, name, children} only — no full entity fields (use 'get'
on a specific id for those). Archived sections/lessons/clips are never shown.
  kind "version"  name = publish name ("" for the Draft)
  kind "section"  name = section path
  kind "lesson"   name = lesson title (falls back to its path)
  kind "video"    name = video title

DEPTH
  --depth defaults to 1 (the version plus its direct children = sections).
  --depth 2 adds lessons; --depth 3 adds videos. --depth all expands the whole
  subtree. A depth that is not a positive integer or "all" exits 3. The --depth
  flag MUST precede the id ('tree --depth 2 <id>', not 'tree <id> --depth 2').

EXAMPLES
  cvm version tree ver_abc
  cvm version tree --depth all ver_abc
  cvm version tree --depth all ver_abc | jq '.children[].name'`;

// ---------------------------------------------------------------------------
// list --course <id>
// ---------------------------------------------------------------------------

const courseOpt = Options.text("course").pipe(
  Options.withDescription("id of the owning Course")
);

const listCmd = Command.make("list", { course: courseOpt }, ({ course }) =>
  Effect.gen(function* () {
    const versions = yield* Effect.flatMap(VersionOperationsService, (svc) =>
      svc.getCourseVersions(course)
    );
    yield* emitNdjson(
      versions.map((v, i) => ({
        id: v.id,
        repoId: v.repoId,
        name: v.name,
        description: v.description,
        createdAt: v.createdAt,
        // versions are ordered newest-first; the latest is the Draft Version.
        isDraft: i === 0,
      }))
    );
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

// ---------------------------------------------------------------------------
// get <id...>
// ---------------------------------------------------------------------------

const ids = Args.text({ name: "id" }).pipe(Args.repeated);

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "version",
    ids,
    fetch: (id) =>
      Effect.flatMap(VersionOperationsService, (svc) =>
        svc.getVersionWithSections(id)
      ).pipe(
        // The CLI owns not-found: turn the domain NotFoundError into undefined
        // so emitGet renders the {entity,id} contract shape + exit 2.
        Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
        Effect.map((version) =>
          version === undefined
            ? undefined
            : {
                id: version.id,
                repoId: version.repoId,
                name: version.name,
                description: version.description,
                createdAt: version.createdAt,
                sections: version.sections.map((s) => ({
                  id: s.id,
                  path: s.path,
                  order: s.order,
                  description: s.description,
                })),
              }
        )
      ),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// tree <id> [--depth N|all]
// ---------------------------------------------------------------------------

interface SkeletonNode {
  readonly id: string;
  readonly kind: "version" | "section" | "lesson" | "video";
  readonly name: string;
  readonly children: ReadonlyArray<SkeletonNode>;
}

const treeId = Args.text({ name: "id" });

const depthOpt = Options.text("depth").pipe(
  Options.withDefault("1"),
  Options.withDescription('levels to expand (positive integer, or "all")')
);

const treeCmd = Command.make(
  "tree",
  { id: treeId, depth: depthOpt },
  ({ id, depth }) =>
    Effect.gen(function* () {
      // Resolve the requested depth: "all" => unbounded, else a positive int.
      let maxDepth: number;
      if (depth === "all") {
        maxDepth = Number.POSITIVE_INFINITY;
      } else {
        const n = Number(depth);
        if (!Number.isInteger(n) || n < 1) {
          return yield* parseError(
            `--depth must be a positive integer or "all" (got "${depth}")`,
            "version"
          );
        }
        maxDepth = n;
      }

      const version = yield* Effect.flatMap(VersionOperationsService, (svc) =>
        svc.getVersionWithSections(id)
      ).pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)));

      if (version === undefined) {
        return yield* notFound("version", id);
      }

      // Build the skeleton lazily down to maxDepth. remaining = levels of
      // children still allowed below the current node (depth 1 => sections).
      const buildVideo = (v: { id: string; title: string }): SkeletonNode => ({
        id: v.id,
        kind: "video",
        name: v.title,
        children: [],
      });

      const buildLesson = (
        l: {
          id: string;
          path: string;
          title: string;
          videos: ReadonlyArray<{
            id: string;
            title: string;
            archived: boolean;
          }>;
        },
        remaining: number
      ): SkeletonNode => ({
        id: l.id,
        kind: "lesson",
        name: l.title !== "" ? l.title : l.path,
        // getVersionWithSections does NOT filter the nested videos relation;
        // archived (deleted) lesson-bound videos are never visible in a tree.
        children:
          remaining >= 1
            ? l.videos.filter((v) => !v.archived).map(buildVideo)
            : [],
      });

      const buildSection = (
        s: {
          id: string;
          path: string;
          lessons: ReadonlyArray<{
            id: string;
            path: string;
            title: string;
            videos: ReadonlyArray<{
              id: string;
              title: string;
              archived: boolean;
            }>;
          }>;
        },
        remaining: number
      ): SkeletonNode => ({
        id: s.id,
        kind: "section",
        name: s.path,
        children:
          remaining >= 1
            ? s.lessons.map((l) => buildLesson(l, remaining - 1))
            : [],
      });

      const root: SkeletonNode = {
        id: version.id,
        kind: "version",
        name: version.name,
        children:
          maxDepth >= 1
            ? version.sections.map((s) => buildSection(s, maxDepth - 1))
            : [],
      };

      yield* emitObject(root);
    })
).pipe(Command.withDescription(detail(TREE_HELP)));

// ---------------------------------------------------------------------------
// version (parent)
// ---------------------------------------------------------------------------

export const versionCommand = Command.make("version").pipe(
  Command.withDescription(detail(VERSION_HELP)),
  Command.withSubcommands([listCmd, getCmd, treeCmd])
);
