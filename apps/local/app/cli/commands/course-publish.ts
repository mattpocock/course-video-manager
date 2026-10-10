import { Command, Options } from "@effect/cli";
import { entityIdArg } from "../entity-id";
import { ConfigProvider, Effect, Layer, Logger, LogLevel } from "effect";
import { NodeContext } from "@effect/platform-node";
import { DrizzleService } from "@/services/drizzle-service.server";
import { GitWorktreeProbeLive } from "@cvm/core/git-worktree";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { loadRepoEnv } from "@/services/repo-env";
import { NEEDS_THE_SIDECAR, requireLocalMachine } from "@/cli/local-only";
import { detail, emitObject, notFound, parseError } from "@/cli/helpers";
import { CliOutput } from "@/cli/output";
import {
  ANNOUNCE_NOTHING_BAND,
  PLACEHOLDER_FLOOR_BANDS,
} from "@/packages/course-json";
import { enqueueJob, JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { waitForPublishJob } from "./course-publish-wait";

/**
 * `cvm course publish <courseId> --name vX.Y.Z` — the ONE write verb that
 * leaves the database.
 *
 * Publish (see GLOSSARY.md) runs the Version lifecycle: Submit freezes the
 * Draft as a Pending Version (stamping name + description) and clones a fresh
 * Draft; any Unexported Video is then rendered while the Commit mirrors the
 * Pending Version's shippable output to Dropbox (`.mp4`s + `course.json` +
 * `course.schema.json`) — the two overlap, a Video uploading as soon as its
 * own export finishes — ending in the atomic `course.json` rename (the commit
 * receipt); Promote then marks it Published. A caught Commit failure — or a
 * failed export — auto-Discards the Pending Version.
 *
 * The command runs none of that itself. It ENQUEUES a `publish` Job, which the
 * Sidecar runs (`sidecar/kinds/publish.ts`, plan §3 of
 * docs/plans/background-jobs-sidecar.md) — the same Job the publish page
 * starts, in the same one-at-a-time lane, logged in the same place. `--wait`
 * follows it to the end and keeps the output contract of the in-process
 * command it replaced: the same result object, the same tagged errors and
 * exit codes.
 *
 * NAME CONTRACT
 *   The version name MUST be a lowercase-'v' prefixed semver — `v1.2.3`,
 *   optionally with a `-prerelease` and/or `+build` suffix. We validate the
 *   SHAPE here (exit 3 on a bad name) and additionally refuse a name already
 *   worn by a Published Version of this course. That check is only a fast
 *   path: the name is written at Submit, inside the Job, so Submit checks it
 *   again under the course lock (`VersionNameTakenError` →
 *   `PublishValidationError`) — two Publishes of one name queued back to back
 *   both pass this one.
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
 * The service graph the `publish` command runs inside: enough to check the
 * Course and the name and to write the Job row. The work itself — ffmpeg,
 * Dropbox, the Version lifecycle — is the Sidecar's, so none of its services
 * are built here.
 */
const publishLayer = Layer.mergeAll(
  CourseOperationsService.Default,
  VersionOperationsService.Default,
  JobOperationsService.Default,
  NodeContext.layer
).pipe(
  Layer.provideMerge(
    DrizzleService.Default.pipe(Layer.provide(GitWorktreeProbeLive))
  )
);

// ---------------------------------------------------------------------------
// options / args
// ---------------------------------------------------------------------------

const courseId = entityIdArg("course", "courseId");

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

// The Placeholder Floor, spelled as a band. Options.choice rejects any other
// spelling in the PARSER, so a malformed floor never reaches the machine gate,
// let alone a write. The default is the announce-nothing band, so omitting the
// flag publishes exactly what it published before ADR 0029 — and the band's
// meaning is shared with `cvm course readiness` through one module, so the two
// verbs can never disagree about what `--placeholders p2` announces.
const waitOpt = Options.boolean("wait").pipe(
  Options.withDescription(
    "follow the Publish Job until it settles and print its result (default: print the queued Job and return)"
  )
);

const placeholdersOpt = Options.choice("placeholders", [
  ...PLACEHOLDER_FLOOR_BANDS,
]).pipe(
  Options.withDefault(ANNOUNCE_NOTHING_BAND),
  Options.withDescription(
    "the Placeholder Floor — the lowest Lesson Priority band whose unshippable Lessons ship as Placeholder Lessons: none | p1 | p2 | p3 (default: none)"
  )
);

const PUBLISH_HELP = `Publish a Course: mirror its Draft Version to Dropbox, then freeze it as a
named Published Version.

Publish is the release operation (see GLOSSARY.md). It (1) validates the
shippable output, (2) SUBMITS the Draft — freezing it as a Pending Version
stamped with --name and --description, and cloning a fresh Draft to carry on
editing, (3) EXPORTS any Unexported Video and COMMITS at the same time — each
Video starts uploading the moment its own export finishes, into a
content-addressed asset bundle in Dropbox, ending in the atomic course.json
rename that is the commit receipt, (4) reclaims stale exports, and (5)
PROMOTES the Pending Version to Published. Submit comes before the export so
encoding and uploading always work against an immutable Pending Version — a
Clip edit landing mid-Publish can never invalidate work in flight, and the
bundle's address is knowable before any encoding starts. The published
snapshot is immutable and can never be deleted; a failed export or Commit
auto-Discards the Pending Version (see FAILURE HANDLING).

A JOB THE SIDECAR RUNS
  This command checks the name and the Course, then ENQUEUES a Publish Job and
  returns. The Sidecar (started by 'pnpm dev' / 'pnpm start' on the author's
  machine) runs it, exactly as it runs a Publish pressed on the web publish
  page: one Publish at a time, its progress in the Upload Manager, its log at
  .data/logs/jobs/<jobId>.jsonl. A Publish runs ONCE: it is never retried, and
  never re-run on its own after the Sidecar stops or dies mid-run. Pass --wait
  to follow it to the end. If the Sidecar is not running, the Job waits in the
  queue until it is.

LOCAL-ONLY
  The Publish is run by this machine's Sidecar, which renders with ffmpeg and
  mirrors the finished videos directory to Dropbox, so it needs the author's
  machine. On any other box it is refused before anything happens — _tag
  "LocalOnlyCommandError", exit 7, no Job, nothing half-done. Stop rather than
  retry.

CONCURRENCY
  Export and upload are separate pools with separate budgets, connected by a
  per-Video handoff: encoding stays six-way concurrent (GPU-bound) while
  uploads run at DROPBOX_UPLOAD_CONCURRENCY (default 4, network-bound). A
  Publish therefore costs roughly the longer of the two phases rather than
  their sum. Export garbage collection runs only once every upload has
  finished, so it can never unlink a file mid-transfer.

ADDRESSING
  The positional argument is the COURSE id (find it via 'cvm course list'). The
  Draft Version (the course's latest) is what gets published — you do not pass a
  version id.

VERSION NAME (--name, required)
  Must be a lowercase-'v' prefixed SemVer: v<major>.<minor>.<patch>, optionally
  with a -prerelease and/or +build suffix. Examples: v1.0.0, v2.3.1,
  v1.0.0-beta.2. A malformed name, or one already used by a Published Version of
  this course, is rejected (exit 3) before anything is written. The name is
  checked again at Submit, so a second Publish of the same name queued before
  the first ran ends PublishValidationError { versionNameTaken } (exit 3, with
  --wait) and releases nothing.

THE PLACEHOLDER FLOOR (--placeholders)
  A PLACEHOLDER LESSON is a Lesson this release announces by title alone — no
  video, no body, no description — so a learner can read the shape of a Course
  before it is filmed. The PLACEHOLDER FLOOR is the lowest Lesson Priority band
  whose unshippable Lessons ship that way: 'none' (announce nothing, the
  default), 'p1', 'p2', 'p3'. Any other spelling is refused by the parser,
  before the machine gate and before anything is written.
  Three rules decide what a floor announces:
    A gap Autofill can close never makes a Lesson a Placeholder Lesson. Only
    three HARD GAPS count — no active Video, a Video with no Clips, a Video with
    no body. A missing description, missing Chapters and an unexported .mp4 are
    not gaps at all.
    A Lesson is all-or-nothing: one hard gap on any active Video decides the
    whole Lesson.
    The floor BEATS the to-do toggle inside the bands it names: a to-do,
    unshippable Lesson at or above the floor is announced, not withheld.
    Outside those bands --exclude-todo keeps its job.
  An unshippable Lesson BELOW the floor is WITHHELD — left out of the release
  exactly as an unfinished Lesson is left out today — rather than failing the
  Publish. Ask 'cvm course readiness --placeholders <band>' first to read the
  placeholderLessons and withheldLessons a floor produces; this command ships
  the release those lists describe.

VALIDATION
  The course view must be lint-clean for the effective output. If it is not, the
  publish is refused with a PublishValidationError — nothing is uploaded and no
  version is frozen. An Unexported Video blocks nothing: Publish renders it
  itself as its export stage. Only if that render FAILS does the publish stop,
  with a PublishValidationError naming the failed video ids (and the Pending
  Version already Discarded).

FAILURE HANDLING
  Submit freezes the Draft as a Pending Version and clones a fresh Draft;
  Publish then exports any Unexported Video and the Dropbox Commit uploads it,
  ending in the atomic course.json rename (the commit receipt). An export is
  measured when it is made: a file more than a second shorter than its Clips ask
  for is a truncated encode, so that export FAILS rather than shipping — and a
  failed export auto-Discards the Pending Version and exits 3 with
  PublishValidationError. A short file already sitting at the export address is
  treated the same way: it is re-rendered rather than trusted, and only a second
  short encode fails the Publish. A caught Commit failure likewise auto-Discards:
  a sync failure is retried once in-flight first; missing asset files Discard
  immediately, naming the missing videos. Either way the command exits 4 with
  PublishCommitFailedError — nothing is lost, your edits are safe in the new
  Draft, so fix the cause and publish again. The upload is content-addressed, so
  a re-publish re-uploads nothing that already landed. A Publish interrupted
  partway is never resumed: see below.

  Edits racing a publish are safe: a write serializes with Submit and either
  lands before the freeze (carried into the new Draft) or is refused with
  VersionNotDraftError (exit 3) — retry it against the new Draft.

  A Publish cut off mid-run (its Sidecar stopped or died) ends "interrupted"
  and is NEVER re-run on its own. If it got past Submit it strands a Pending
  Version; the web publish page reconciles it on load (Promote if the receipt
  committed, else one-click Discard). No CLI recovery verb exists: with --wait
  this ends PublishInterruptedError, exit 4.

FLAGS
  --name <vX.Y.Z>     (required) the Published Version name.
  --description <text> (required) description for the Published Version.
  --exclude-todo      withhold to-do Lessons (default ships every Lesson, matching
                      the standalone Dropbox mirror).
  --placeholders <band>
                      the Placeholder Floor: none | p1 | p2 | p3 (default none —
                      announce nothing, today's behaviour exactly).
  --wait              follow the Publish Job until it settles (default: return
                      as soon as it is queued).

OUTPUT
  Without --wait: one pretty JSON object, { jobId, status: "queued", name,
  description, log } — the Job is queued, not done. Follow it in the Upload
  Manager, or run the command with --wait.
  With --wait: one pretty JSON object once the Publish succeeds: { jobId,
  publishedVersionId, newDraftVersionId, name, description, lessons }.
  'lessons' is { ships, placeholders, withheld } — the three Lesson Publish
  Status counts for the release that just went out, under the floor and the
  to-do setting this run used. Together they are every Lesson in the version
  tree. Run 'cvm course readiness --placeholders <band>' to see which Lessons
  they are. While it runs, STDERR carries one JSON line per step of the Job
  ({ "event": "stage", "stage": "exporting" }, …); a failure's tagged object is
  the LAST line of STDERR. A failed Publish ends PublishValidationError (exit
  3) or PublishCommitFailedError (exit 4) as before, or PublishJobFailedError
  (exit 4) for any other cause — read the Job's log for the whole chain. A Job
  that succeeded but never recorded its result ends PublishResultLostError
  (exit 4): the release IS out, so do not publish again.
  Errors go to STDERR as the usual tagged contract object.

EXAMPLES
  cvm course publish course_123 --name v1.0.0 --description "first cut"
  cvm course publish course_123 --name v1.1.0 --description "adds the testing section" --wait
  cvm course publish course_123 --name v2.0.0-beta.1 --description "beta" --exclude-todo
  cvm course publish course_123 --name v0.1.0 --description "the syllabus" --placeholders p2`;

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
    placeholders: placeholdersOpt,
    wait: waitOpt,
  },
  ({ courseId, name, description, excludeTodo, placeholders, wait }) => {
    const includeTodoLessons = !excludeTodo;

    // MACHINE GATE FIRST, ahead of even the name check: the Publish is run by
    // this machine's Sidecar, which renders with ffmpeg and mirrors the
    // finished videos directory to Dropbox, so on a Remote Box a
    // perfectly-formed name would not have helped. Refusing here also means no
    // Job is ever queued.
    const machine = requireLocalMachine(
      "cvm course publish",
      NEEDS_THE_SIDECAR
    );

    // Shape gate SECOND, outside the provided layer: a malformed name fails fast
    // (exit 3) without building the layer or reading .env config.
    if (!isValidPublishVersionName(name)) {
      return machine.pipe(
        Effect.zipRight(
          parseError(
            `--name must be a lowercase-'v' semver (e.g. v1.2.0), got "${name}"`,
            "course"
          )
        )
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

      // The one way in (plan §3.7): the same `publish` Job the publish page
      // enqueues, checked against the kind's own params schema.
      const job = yield* enqueueJob({
        id: null,
        kind: "publish",
        title: course.name,
        params: {
          courseId,
          name,
          description,
          includeTodoLessons,
          placeholders,
        },
        dependsOn: null,
        subject: { type: "course", id: courseId },
        attemptsSpent: 0,
        registry: JOB_KIND_SPECS,
      });
      // Best effort, and silent: a sidecar that is down finds the Job when it
      // starts, and the CLI's STDERR is its error contract.
      yield* nudgeSidecar().pipe(Logger.withMinimumLogLevel(LogLevel.None));
      const log = `.data/logs/jobs/${job.id}.jsonl`;

      if (!wait) {
        return yield* emitObject({
          jobId: job.id,
          status: "queued",
          name,
          description,
          log,
        });
      }

      const out = yield* CliOutput;
      const result = yield* waitForPublishJob({
        jobId: job.id,
        pollMs: 1_000,
        onProgress: (line) => out.stderr(JSON.stringify(line) + "\n"),
      });
      yield* emitObject({
        jobId: job.id,
        publishedVersionId: result.publishedVersionId,
        newDraftVersionId: result.newDraftVersionId,
        name,
        description,
        // WHAT THE RELEASE DID WITH EVERY LESSON. A headless run has no publish
        // page to read the two cards off, so the three Lesson Publish Status
        // counts ride out with the result: they are the only way an agent can
        // see that `--placeholders p2` announced anything, or how many Lessons
        // it left behind. Ask `cvm course readiness --placeholders <band>` for
        // the Lessons themselves.
        lessons: result.lessons,
      });
    });

    // loadRepoEnv MUST run before publishLayer is built: DrizzleService reads
    // DATABASE_URL from process.env.
    return machine.pipe(
      Effect.zipRight(Effect.sync(() => loadRepoEnv())),
      Effect.zipRight(
        run.pipe(
          Effect.provide(publishLayer),
          Effect.withConfigProvider(ConfigProvider.fromEnv())
        )
      )
    );
  }
).pipe(Command.withDescription(detail(PUBLISH_HELP)));
