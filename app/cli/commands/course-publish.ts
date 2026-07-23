import { Args, Command, Options } from "@effect/cli";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { CoursePublishService } from "@/services/course-publish-service";
import { loadRepoEnv } from "@/cli/env";
import { detail, emitObject, notFound, parseError } from "@/cli/helpers";

/**
 * `cvm course publish <courseId> --name vX.Y.Z` — the ONE write verb that
 * leaves the database.
 *
 * Publish (see CONTEXT.md) runs the Version lifecycle: Submit freezes the
 * Draft as a Pending Version (stamping name + description) and clones a fresh
 * Draft; Commit mirrors the Pending Version's shippable output to Dropbox
 * (`.mp4`s + `course.json` + `course.schema.json`), ending in the atomic
 * `course.json` rename (the commit receipt); Promote then marks it Published.
 * A caught Commit failure auto-Discards the Pending Version. This just wraps
 * CoursePublishService.publish for the CLI; the heavy lifting (validation
 * gate, Dropbox sync, lifecycle transitions) lives there.
 *
 * NAME CONTRACT
 *   The version name MUST be a lowercase-'v' prefixed semver — `v1.2.3`,
 *   optionally with a `-prerelease` and/or `+build` suffix. We validate the
 *   SHAPE here (exit 3 on a bad name) and additionally refuse a name already
 *   worn by a Published Version of this course, so a publish can never silently
 *   duplicate a release tag.
 */

// The official SemVer 2.0.0 regex, prefixed with a required lowercase `v`.
// Source: https://semver.org (the "recommended" MAJOR.MINOR.PATCH regex).
const SEMVER_WITH_V =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Whether `name` is a valid publish version name: a lowercase-'v' prefixed
 * SemVer (e.g. "v1.0.0", "v2.1.3-beta.1"). Exported for direct unit testing.
 */
export const isValidPublishVersionName = (name: string): boolean =>
  SEMVER_WITH_V.test(name);

/**
 * The self-contained service graph the `publish` command runs inside. It is
 * built LOCALLY (inside the handler via Effect.provide), NOT merged into the
 * shared cliRuntime, on purpose: CoursePublishService pulls in
 * VideoProcessingService, which reads OPENAI_API_KEY at BUILD time. Merging it
 * into the shared layer would make every read command demand that key. Building
 * it here means only `publish` pays that cost.
 */
const publishDeps = Layer.mergeAll(
  CourseOperationsService.Default,
  VideoOperationsService.Default,
  VersionOperationsService.Default,
  LinkAuthOperationsService.Default,
  VideoProcessingService.Default,
  FFmpegCommandsService.Default,
  NodeContext.layer
).pipe(Layer.provideMerge(DrizzleService.Default));

const publishLayer = CoursePublishService.Default.pipe(
  Layer.provideMerge(publishDeps)
);

// ---------------------------------------------------------------------------
// options / args
// ---------------------------------------------------------------------------

const courseId = Args.text({ name: "courseId" });

const nameOpt = Options.text("name").pipe(
  Options.withDescription(
    "publish version name — a lowercase-'v' semver, e.g. v1.2.0"
  )
);

const descriptionOpt = Options.text("description").pipe(
  Options.withDescription(
    "free-text description carried on the Published Version (required)"
  )
);

const excludeTodoOpt = Options.boolean("exclude-todo").pipe(
  Options.withDescription(
    "withhold to-do Lessons from this publish (default: ship every Lesson)"
  )
);

const PUBLISH_HELP = `Publish a Course: mirror its Draft Version to Dropbox, then freeze it as a
named Published Version.

Publish is the release operation (see CONTEXT.md). It (1) validates the
shippable output, (2) SUBMITS the Draft — freezing it as a Pending Version
stamped with --name and --description, and cloning a fresh Draft to carry on
editing, (3) COMMITS — copies every shipping Video's .mp4 plus a
content-addressed asset bundle into Dropbox, ending in the atomic course.json
rename that is the commit receipt, and (4) PROMOTES the Pending Version to
Published. The published snapshot is immutable and can never be deleted; a
failed Commit auto-Discards the Pending Version (see FAILURE HANDLING).

ADDRESSING
  The positional argument is the COURSE id (find it via 'cvm course list'). The
  Draft Version (the course's latest) is what gets published — you do not pass a
  version id.

VERSION NAME (--name, required)
  Must be a lowercase-'v' prefixed SemVer: v<major>.<minor>.<patch>, optionally
  with a -prerelease and/or +build suffix. Examples: v1.0.0, v2.3.1,
  v1.0.0-beta.2. A malformed name, or one already used by a Published Version of
  this course, is rejected (exit 3) before anything is written.

VALIDATION
  Every shipping Video must already be exported (have its .mp4) and the course
  view must be lint-clean for the effective output. If not, the publish is
  refused with a PublishValidationError listing the offending video ids — nothing
  is uploaded and no version is frozen. Export the missing videos first, then
  re-run.

FAILURE HANDLING
  Submit freezes the Draft as a Pending Version and clones a fresh Draft; the
  Dropbox Commit then uploads it, ending in the atomic course.json rename (the
  commit receipt). A caught Commit failure auto-Discards the Pending Version:
  a sync failure is retried once in-flight first; missing asset files Discard
  immediately, naming the missing videos. Either way the command exits 4 with
  PublishCommitFailedError — nothing is lost, your edits are safe in the new
  Draft, so fix the cause and publish again. The upload is content-addressed,
  so a re-publish re-uploads nothing that already landed.

  Edits racing a publish are safe: a write serializes with Submit and either
  lands before the freeze (carried into the new Draft) or is refused with
  VersionNotDraftError (exit 3) — retry it against the new Draft.

  A crash between the course.json rename and Promote strands the Pending
  Version at rest; the web publish page reconciles it on load (Promote if the
  receipt committed, else one-click Discard). No CLI recovery verb exists.

FLAGS
  --name <vX.Y.Z>     (required) the Published Version name.
  --description <text> (required) description for the Published Version.
  --exclude-todo      withhold to-do Lessons (default ships every Lesson, matching
                      the standalone Dropbox mirror).

OUTPUT
  One pretty JSON object: { publishedVersionId, newDraftVersionId, name,
  description }. Errors go to STDERR as the usual tagged contract object.

EXAMPLES
  cvm course publish course_123 --name v1.0.0 --description "first cut"
  cvm course publish course_123 --name v1.1.0 --description "adds the testing section"
  cvm course publish course_123 --name v2.0.0-beta.1 --description "beta" --exclude-todo`;

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

export const publishCmd = Command.make(
  "publish",
  {
    courseId,
    name: nameOpt,
    description: descriptionOpt,
    excludeTodo: excludeTodoOpt,
  },
  ({ courseId, name, description, excludeTodo }) => {
    const includeTodoLessons = !excludeTodo;

    // Shape gate FIRST, outside the provided layer: a malformed name fails fast
    // (exit 3) without building the heavy publish stack or reading .env config.
    if (!isValidPublishVersionName(name)) {
      return parseError(
        `--name must be a lowercase-'v' semver (e.g. v1.2.0), got "${name}"`,
        "course"
      );
    }

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

      // Uniqueness gate: a Published Version already wearing this name would make
      // two immutable releases collide on their tag.
      const versionOps = yield* VersionOperationsService;
      const versions = yield* versionOps.getCourseVersions(courseId);
      if (versions.some((v) => v.name === name)) {
        return yield* parseError(
          `version name "${name}" is already used by a published version of this course`,
          "course"
        );
      }

      // A PublishValidationError (unexported videos / lint) is left to surface
      // with its own tag: render.ts maps it to exit 3 and its enumerable fields
      // (unexportedVideoIds, courseViewLintCount) reach the agent verbatim,
      // whereas a flattened ParseError message would be dropped by the renderer.
      const publishSvc = yield* CoursePublishService;
      const result = yield* publishSvc.publish({
        courseId,
        versionName: name,
        versionDescription: description,
        includeTodoLessons,
      });

      yield* emitObject({
        publishedVersionId: result.publishedVersionId,
        newDraftVersionId: result.newDraftVersionId,
        name,
        description,
      });
    });

    // loadRepoEnv MUST run before publishLayer is built: VideoProcessingService
    // reads OPENAI_API_KEY at build time and the sync reads DROPBOX_REMOTE_PATH /
    // FINISHED_VIDEOS_DIRECTORY at runtime, all from process.env.
    return Effect.sync(() => loadRepoEnv()).pipe(
      Effect.zipRight(
        run.pipe(
          Effect.provide(publishLayer),
          Effect.withConfigProvider(ConfigProvider.fromEnv())
        )
      )
    );
  }
).pipe(Command.withDescription(detail(PUBLISH_HELP)));
