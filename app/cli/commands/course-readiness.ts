import { Args, Command, Options } from "@effect/cli";
import { ConfigProvider, Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import {
  PUBLISH_BLOCKING_LISTS,
  validatePublishability,
} from "@/services/course-publish-readiness";
import { loadRepoEnv } from "@/cli/env";
import { detail, emitObject, notFound, resolveVersionId } from "@/cli/helpers";

/**
 * `cvm course readiness <courseId>` — the READ half of publish validation.
 *
 * Answers "what is actually between this Course and shipping?" in one object:
 * the outstanding-work lists (Unexported Videos, course-view lints, invalid
 * Lesson role combos, incomplete Videos) plus a toggle-independent progress
 * count. Only three of those four lists actually block a release — see
 * PUBLISH_BLOCKING_LISTS in the readiness module, and the `publishable` /
 * `exportsRequired` split below.
 *
 * COMPUTED LOCALLY, NOT VIA THE SERVER. Whether a Video is exported is
 * filesystem-derived (an Export Hash matched against
 * `{courseId}-{exportHash}.mp4` in FINISHED_VIDEOS_DIRECTORY — see CONTEXT.md),
 * so this needs a filesystem, not an HTTP round-trip. The same numbers are
 * reachable over HTTP at /api/courseVersions/:versionId/unexported-videos, but
 * `cvm` reads must keep working with the dev server stopped — unlike the write
 * verbs, which health-check it via BackupCoordinator. The computation lives in
 * CoursePublishService's readiness module, so the CLI and the publish gate can
 * never disagree.
 */

const courseId = Args.text({ name: "courseId" });

const versionOpt = Options.text("course-version").pipe(
  Options.optional,
  Options.withDescription(
    "pin a specific CourseVersion (default: the course's Draft Version)"
  )
);

const excludeTodoOpt = Options.boolean("exclude-todo").pipe(
  Options.withDescription(
    "report the position where to-do Lessons are WITHHELD (default: every Lesson ships)"
  )
);

const READINESS_HELP = `Report PUBLISH READINESS and authoring progress for a Course — what is actually
between it and shipping.

This runs the exact computation 'cvm course publish' runs before it writes
anything, read-only. It reports four outstanding-work lists, but they are NOT
equivalent — see WHAT ACTUALLY BLOCKS A PUBLISH.

ADDRESSING
  The positional argument is the COURSE id (find it via 'cvm course list'). By
  default the course's DRAFT VERSION is measured; --course-version pins another.

THE TO-DO TOGGLE
  A publish ships every Lesson by default; --exclude-todo withholds Lessons whose
  authoringStatus is "todo". Blockers differ between the two positions, so this
  command reports the one you asked for and mirrors the flag back as
  includesTodoLessons. Pass the same flag you would pass to 'course publish'.

WHAT ACTUALLY BLOCKS A PUBLISH
  Only three of the four lists stop a release, and 'publishable' reflects
  exactly those three:
    courseViewLints       REFUSE the publish outright.
    invalidLessonCombos   Not checked at the gate, but they fail the later
    incompleteVideos      course.json build — so the publish still cannot land.
    unexportedVideos      Do NOT block. 'course publish' RENDERS them itself as
                          its exporting stage and carries on. They are pending
                          machine work, reported separately as exportsRequired.
  So publishable:true with exportsRequired:8 is a real and common state: this
  course WILL ship, and publishing it will render 8 videos on the way. Do not
  gate a decision on the unexported list.

EXPORT IS FILESYSTEM-DERIVED
  A Video is EXPORTED when a rendered {courseId}-{exportHash}.mp4 exists in the
  finished-videos directory, where the Export Hash is derived from its clip
  filenames, timestamps, clip order and the Export Version Key. An UNEXPORTED
  VIDEO is one whose current hash matches no file on disk. This is read straight
  off disk; the dev server does NOT need to be running.

OUTPUT (one pretty JSON object)
  courseId              The Course measured.
  versionId             The CourseVersion actually measured (resolved Draft, or
                        whatever --course-version pinned).
  includesTodoLessons   Whether to-do Lessons are counted as shipping.
  publishable           true when courseViewLints, invalidLessonCombos and
                        incompleteVideos are ALL empty. Ignores unexportedVideos
                        (see above).
  blockedBy[]           Which of those three lists are non-empty — the reason
                        publishable is false, in one field. Empty when true.
  exportsRequired       How many Videos a publish would render first. Costs
                        time, not authoring; never affects publishable.
  unexportedVideos[]    { id, title } — Videos with no .mp4 on disk. title is
                        "<sectionPath>/<lessonPath>/<title>".
  courseViewLints[]     Lesson Warnings + Video Warnings on the effective
                        output, itemised: { scope, sectionPath, lessonPath,
                        kind } plus videoTitle when scope is "video". A
                        course-scope entry belongs to no single video —
                        { scope: "course", kind: "duplicateQuizId", quizId,
                        videoPaths[] } names every video sharing one quiz id.
                        Includes the kinds the app's Autofill owns
                        (missingChapters, missingDescription): they still
                        refuse a publish, the authoring surfaces just no
                        longer show them.
  invalidLessonCombos[] Lessons whose Video roles are ambiguous (e.g. a
                        Solution with no Problem).
  incompleteVideos[]    Shipping Videos missing a required field.
  counts                One integer per list above, for a cheap glance.
  progress              Toggle-INDEPENDENT authoring counts over the whole
                        version tree (including Lessons no publish would ship,
                        because those are the work still to do):
                          sections
                          lessons { total, todo, done, unset }
                          videos  { total, exported, unexported, noClips }
                        authoringStatus has no default, so a Lesson may be
                        neither todo nor done: use 'unset' rather than deriving
                        it, and note total - done overstates remaining work.
                        noClips = a Video with no Clips yet, so nothing to export.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id ('readiness --exclude-todo <id>',
  NOT 'readiness <id> --exclude-todo') — a flag after the id is rejected (exit 3).

EXAMPLES
  cvm course readiness course_123
  cvm course readiness --exclude-todo course_123
  cvm course readiness --course-version ver_abc course_123
  # Is it shippable right now, and if not why?
  cvm course readiness course_123 | jq -c '{publishable, blockedBy}'
  # What would a publish have to render on the way?
  cvm course readiness course_123 | jq -r '.unexportedVideos[].title'
  # One-line summary for a daily sweep:
  cvm course readiness course_123 |
    jq -c '{publishable, blockedBy, exportsRequired, progress}'`;

export const readinessCmd = Command.make(
  "readiness",
  { courseId, version: versionOpt, excludeTodo: excludeTodoOpt },
  ({ courseId, version, excludeTodo }) => {
    const includeTodoLessons = !excludeTodo;

    const run = Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const course = yield* courseOps
        .getCourseById(courseId)
        .pipe(
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
        );
      if (course === undefined) {
        return yield* notFound("course", courseId);
      }

      const versionId = yield* resolveVersionId({ courseId, version });
      const readiness = yield* validatePublishability(versionId);
      const position = includeTodoLessons
        ? readiness.withTodo
        : readiness.withoutTodo;

      const lists = {
        unexportedVideos: position.unexportedVideos,
        courseViewLints: position.courseViewLints,
        invalidLessonCombos: position.invalidLessonCombos,
        incompleteVideos: position.incompleteVideos,
      };

      // Only the three PUBLISH_BLOCKING_LISTS decide `publishable`. Unexported
      // Videos are pointedly NOT among them: `cvm course publish` renders them
      // itself as its `exporting` stage and carries on, so a course whose only
      // outstanding item is un-rendered .mp4s WILL publish. Folding them in
      // would report publishable:false for the single most common state — the
      // one a daily stand-up asks about most — and be wrong.
      const blockedBy = PUBLISH_BLOCKING_LISTS.filter(
        (list) => lists[list].length > 0
      );

      yield* emitObject({
        courseId: readiness.courseId,
        versionId: readiness.versionId,
        includesTodoLessons: includeTodoLessons,
        publishable: blockedBy.length === 0,
        blockedBy,
        // Pending machine work, not an authoring gap: publish would render
        // these first. Non-zero with publishable:true means "it will ship, but
        // it has N videos to export on the way".
        exportsRequired: lists.unexportedVideos.length,
        counts: {
          unexportedVideos: lists.unexportedVideos.length,
          courseViewLints: lists.courseViewLints.length,
          invalidLessonCombos: lists.invalidLessonCombos.length,
          incompleteVideos: lists.incompleteVideos.length,
        },
        ...lists,
        progress: readiness.progress,
      });
    });

    // FINISHED_VIDEOS_DIRECTORY comes from the repo .env, and the export-hash
    // existence checks need a real filesystem — hence NodeContext here rather
    // than in the shared cliLayer. Unlike `course publish`, this pulls in no
    // VideoProcessingService, so no OPENAI_API_KEY is demanded.
    return Effect.sync(() => loadRepoEnv()).pipe(
      Effect.zipRight(
        run.pipe(
          Effect.provide(NodeContext.layer),
          Effect.withConfigProvider(ConfigProvider.fromEnv())
        )
      )
    );
  }
).pipe(Command.withDescription(detail(READINESS_HELP)));
