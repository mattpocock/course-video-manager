import { Args, Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { courseSearchCmd } from "./search";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  detail,
  emitGet,
  emitNdjson,
  emitObject,
  notFound,
  resolveVersionId,
} from "@/cli/helpers";

// ---------------------------------------------------------------------------
// Shared option/arg definitions
// ---------------------------------------------------------------------------

const ids = Args.text({ name: "id" }).pipe(Args.repeated);
const id = Args.text({ name: "id" });
const archived = Options.boolean("archived");
const version = Options.text("course-version").pipe(Options.optional);
const depth = Options.text("depth").pipe(Options.withDefault("1"));

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const LIST_HELP = `List every Course (the primary domain entity — a structured collection of
versions, sections, lessons, and videos backed by a CourseRepo on disk).

By default only ACTIVE courses are listed. Pass --archived to INCLUDE archived
courses (course is one of only two nouns with a viewable archive). Each row is
identity-rich so you can map a name to an id in a single call.

OUTPUT (NDJSON, one compact object per line — empty set prints nothing):
  id        Stable course id (use it with 'course get' / 'course tree').
  name      Human course name.
  slug      URL/identity slug derived from the name.
  filePath  Path to the backing CourseRepo on disk, or null for a Ghost Course
            (a DB-only planning course with no repo yet).
  archived  Whether the course is archived (abandoned/hidden), not deleted.
  memory    Free-text authoring notes carried on the course.

EXAMPLES
  cvm course list
  cvm course list --archived
  cvm course list | jq -r '.id + "\\t" + .name'`;

const listCmd = Command.make("list", { archived }, ({ archived }) =>
  Effect.gen(function* () {
    const svc = yield* CourseOperationsService;
    const rows = archived
      ? yield* svc.getArchivedCourses()
      : yield* svc.getCourses();
    yield* emitNdjson(rows);
  })
).pipe(Command.withDescription(detail(LIST_HELP)));

// ---------------------------------------------------------------------------
// get <id...>
// ---------------------------------------------------------------------------

const GET_HELP = `Fetch one or more Courses by id, SHALLOW: the course row plus the immediate
Sections of its DRAFT Version (latest by createdAt). 'get' is variadic and
ID-ONLY (find ids via 'course list').

This is a fixed-depth read — the course's own fields plus a list of its Draft
Sections (id, path, order, description). It does NOT descend into lessons,
videos or clips, and does NOT enumerate published snapshots. To walk deeper use
'course tree' (skeleton, --depth N|all), or drill in with the section/lesson/
video commands.

OUTPUT
  One id  => a single pretty-printed JSON object, exit 0.
  Many ids => NDJSON (one compact course object per line). Any missing ids are
             reported on STDERR and the command exits 2; STDOUT stays pure.
  Missing single id => NotFoundError on STDERR, exit 2.

Fields: the course (id, name, slug, filePath, archived, memory),
draftVersionId (the resolved Draft Version, or null if the course has none),
and sections[] = { id, path, order, description } of that Draft Version.

EXAMPLES
  cvm course get <courseId>
  cvm course get <courseId> | jq '.sections[].path'
  cvm course get <id1> <id2> | jq '{id, name}'`;

const getCmd = Command.make("get", { ids }, ({ ids }) =>
  emitGet({
    entity: "course",
    ids,
    fetch: (cid) =>
      Effect.gen(function* () {
        const courseSvc = yield* CourseOperationsService;
        const versionSvc = yield* VersionOperationsService;
        // Shallow: the course row + the DRAFT version's immediate Sections.
        const course = yield* courseSvc
          .getCourseById(cid)
          .pipe(
            Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
          );
        if (course === undefined) return undefined;

        const draft = yield* versionSvc.getLatestCourseVersion(cid);
        const sections = draft
          ? (yield* versionSvc.getVersionWithSections(draft.id)).sections.map(
              (s) => ({
                id: s.id,
                path: s.path,
                order: s.order,
                description: s.description,
              })
            )
          : [];

        return { ...course, draftVersionId: draft?.id ?? null, sections };
      }),
  })
).pipe(Command.withDescription(detail(GET_HELP)));

// ---------------------------------------------------------------------------
// tree <id>
// ---------------------------------------------------------------------------

type TreeNode = {
  id: string;
  kind: string;
  name: string;
  children: TreeNode[];
};

const node = (
  nodeId: string,
  kind: string,
  name: string,
  remaining: number,
  childFns: () => TreeNode[]
): TreeNode => ({
  id: nodeId,
  kind,
  name,
  children: remaining <= 0 ? [] : childFns(),
});

const TREE_HELP = `Print the SKELETON of a Course's structure for the version's Draft (default)
or a pinned Published Version (--course-version <id>). Each node is just
{ id, kind, name, children } — no full entity fields — so an agent can map the
shape cheaply, then 'get' the specific id it wants.

Hierarchy of kinds: course -> section -> lesson -> video -> clip. 'name' is the
course name, or the path of a section/lesson/video, or a clip's source filename.

DEPTH
  --depth 1   (default) course + its direct Sections.
  --depth N   expand N levels below the course.
  --depth all expand the full subtree (course..clips).

VERSIONS
  Defaults to the Draft Version (latest by createdAt). Pass --course-version <id> to
  pin a Published Version snapshot; an unknown version id exits 2.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id (e.g. 'tree --depth all <id>', NOT
  'tree <id> --depth all') — a flag placed after the id is rejected (exit 3).

EXAMPLES
  cvm course tree <courseId>
  cvm course tree --depth all <courseId>
  cvm course tree --depth 3 --course-version <publishedVersionId> <courseId>
  cvm course tree --depth all <courseId> | jq '.. | select(.kind? == "video") | .id'`;

const treeCmd = Command.make(
  "tree",
  { id, depth, version },
  ({ id, depth, version }) =>
    Effect.gen(function* () {
      const maxDepth =
        depth.trim().toLowerCase() === "all"
          ? Number.POSITIVE_INFINITY
          : Number.parseInt(depth, 10);
      const svc = yield* CourseOperationsService;
      // Validate / resolve the version (Draft by default, --course-version to pin).
      const versionId = yield* resolveVersionId({ courseId: id, version });

      const course = yield* svc
        .getCourseWithSlimClipsById(id, versionId)
        .pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
        );

      if (course === undefined) {
        return yield* notFound("course", id);
      }

      const ver = course.versions[0];
      const sections = ver?.sections ?? [];

      const tree = node(course.id, "course", course.name, maxDepth, () =>
        sections.map((section) =>
          node(section.id, "section", section.path, maxDepth - 1, () =>
            section.lessons.map((lesson) =>
              node(lesson.id, "lesson", lesson.path, maxDepth - 2, () =>
                lesson.videos.map((video) =>
                  node(video.id, "video", video.path, maxDepth - 3, () =>
                    video.clips.map((clip) =>
                      node(
                        clip.id,
                        "clip",
                        clip.videoFilename ?? clip.id,
                        maxDepth - 4,
                        () => []
                      )
                    )
                  )
                )
              )
            )
          )
        )
      );

      yield* emitObject(tree);
    })
).pipe(Command.withDescription(detail(TREE_HELP)));

// ---------------------------------------------------------------------------
// transcripts <id>
// ---------------------------------------------------------------------------

const TRANSCRIPTS_HELP = `Project every Video Transcript in a Course's Draft Version (or a pinned
--course-version) as prose. A Transcript is the ordered text projection of a Video —
its Clips and Chapters interleaved in timeline order — the same text shipped as
{video}.transcript.md during Publish.

ID-ONLY: pass the course id (find it via 'course list'). An unknown course id
exits 2.

OUTPUT
  A single JSON object mapping videoId -> transcript string (chapters rendered as
  '## <name>' headers between paragraphs of clip text). Videos with no clips map
  to an empty string.

EXAMPLES
  cvm course transcripts <courseId>
  cvm course transcripts <courseId> | jq -r 'to_entries[] | .key + "\\n" + .value'`;

const transcriptsCmd = Command.make("transcripts", { id }, ({ id }) =>
  Effect.gen(function* () {
    const svc = yield* CourseOperationsService;
    // getVideoTranscripts returns {} for a missing course, so confirm existence
    // ourselves to honour the not-found contract (exit 2).
    const exists = yield* svc
      .getCourseById(id)
      .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)));
    if (exists === undefined) {
      return yield* notFound("course", id);
    }
    const transcripts = yield* svc.getVideoTranscripts(id);
    yield* emitObject(transcripts);
  })
).pipe(Command.withDescription(detail(TRANSCRIPTS_HELP)));

// ---------------------------------------------------------------------------
// course (parent)
// ---------------------------------------------------------------------------

const COURSE_HELP = `Course — the primary domain entity: a structured collection of versions,
sections, lessons, and videos, backed by a CourseRepo (a git repo on disk) and
published as immutable snapshots.

A Course's structure is snapshotted into Course Versions: a single Draft Version
(latest, mutable) plus zero or more Published Versions (frozen at Publish). A
Course with no filePath is a Ghost Course — a DB-only planning space. Version-
scoped reads (tree, transcripts) default to the Draft Version.

VERBS
  list                 All courses (--archived to include archived).
  get <id...>          Course + section/lesson structure summary (variadic).
  tree <id>            Structure skeleton (--depth N|all, --course-version <id>).
  transcripts <id>     Video transcripts for the version, keyed by video id.
  search <id> <query>  Case-insensitive substring search down this course's
                       Draft subtree (--type course|section|lesson|video|segment).

Typical workflow: 'cvm course list' to find an id, then 'cvm course tree <id>'
to see the shape, then drill in with 'cvm course get <id>' or the per-noun
commands (section/lesson/video).`;

export const courseCommand = Command.make("course").pipe(
  Command.withDescription(detail(COURSE_HELP)),
  Command.withSubcommands([
    listCmd,
    getCmd,
    treeCmd,
    transcriptsCmd,
    courseSearchCmd,
  ])
);
