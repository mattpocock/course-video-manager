import { Args, Command, Options } from "@effect/cli";
import { ConfigProvider, Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { validatePublishability } from "@/services/course-publish-readiness";
import { loadRepoEnv } from "@/cli/env";
import { detail, emitObject, notFound, resolveVersionId } from "@/cli/helpers";

/**
 * `cvm course readiness <courseId>` — the READ half of publish validation.
 *
 * Answers "what is actually between this Course and shipping?" in one object:
 * the publish blockers (Unexported Videos, Course View Lints, invalid Lesson
 * role combos, incomplete Videos) plus a toggle-independent progress count.
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

export const READINESS_HELP = `Report PUBLISH READINESS and authoring progress for a Course — what is actually
between it and shipping.

This is the read-only half of the publish validation gate ('cvm course publish'
runs the same computation before it writes anything), so the blockers listed
here are exactly the blockers that would refuse a publish.

ADDRESSING
  The positional argument is the COURSE id (find it via 'cvm course list'). By
  default the course's DRAFT VERSION is measured; --course-version pins another.

THE TO-DO TOGGLE
  A publish ships every Lesson by default; --exclude-todo withholds Lessons whose
  authoringStatus is "todo". Blockers differ between the two positions, so this
  command reports the one you asked for and mirrors the flag back as
  includesTodoLessons. Pass the same flag you would pass to 'course publish'.

EXPORT IS FILESYSTEM-DERIVED
  A Video is EXPORTED when a rendered {courseId}-{exportHash}.mp4 exists in the
  finished-videos directory, where the Export Hash is derived from its clip
  filenames, timestamps, clip order and the Export Version Key. An UNEXPORTED
  VIDEO is one whose current hash matches no file on disk — it blocks publishing.
  This is read straight off disk; the dev server does NOT need to be running.

OUTPUT (one pretty JSON object)
  courseId              The Course measured.
  versionId             The CourseVersion actually measured (resolved Draft, or
                        whatever --course-version pinned).
  includesTodoLessons   Whether to-do Lessons are counted as shipping.
  publishable           true when every blocker list below is empty.
  blockers.unexportedVideos[]   { id, title } — Videos with no .mp4 on disk.
                                title is "<sectionPath>/<lessonPath>/<title>".
  blockers.courseViewLints[]    Course View Lints (Lesson Warnings + Video
                                Warnings) on the effective output, itemised:
                                { scope, sectionPath, lessonPath, kind } plus
                                videoTitle when scope is "video". A non-empty
                                list alone refuses a publish.
  blockers.invalidLessonCombos[]  Lessons whose Video roles are ambiguous
                                (e.g. a Solution with no Problem).
  blockers.incompleteVideos[]     Shipping Videos missing a required field.
  counts                One integer per blocker list, for a cheap glance.
  progress              Toggle-INDEPENDENT authoring counts over the whole
                        version tree (including Lessons no publish would ship,
                        because those are the work still to do):
                          sections
                          lessons { total, todo, done }
                          videos  { total, exported, unexported, noClips }
                        noClips = a Video with no Clips yet, so nothing to export.

NOTE ON FLAG ORDER
  Options must come BEFORE the positional id ('readiness --exclude-todo <id>',
  NOT 'readiness <id> --exclude-todo') — a flag after the id is rejected (exit 3).

EXAMPLES
  cvm course readiness course_123
  cvm course readiness --exclude-todo course_123
  cvm course readiness --course-version ver_abc course_123
  # Is it shippable right now?
  cvm course readiness course_123 | jq '.publishable'
  # What still needs exporting?
  cvm course readiness course_123 | jq -r '.blockers.unexportedVideos[].title'
  # One-line progress summary for a daily sweep:
  cvm course readiness course_123 | jq -c '{publishable, counts, progress}'`;

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

      const blockers = {
        unexportedVideos: position.unexportedVideos,
        courseViewLints: position.courseViewLints,
        invalidLessonCombos: position.invalidLessonCombos,
        incompleteVideos: position.incompleteVideos,
      };

      yield* emitObject({
        courseId: readiness.courseId,
        versionId: readiness.versionId,
        includesTodoLessons: includeTodoLessons,
        // The publish gate itself refuses on lints and unexported videos; the
        // other two lists fail the course.json build downstream. "Publishable"
        // means all four are clear.
        publishable:
          blockers.unexportedVideos.length === 0 &&
          blockers.courseViewLints.length === 0 &&
          blockers.invalidLessonCombos.length === 0 &&
          blockers.incompleteVideos.length === 0,
        counts: {
          unexportedVideos: blockers.unexportedVideos.length,
          courseViewLints: blockers.courseViewLints.length,
          invalidLessonCombos: blockers.invalidLessonCombos.length,
          incompleteVideos: blockers.incompleteVideos.length,
        },
        blockers,
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
