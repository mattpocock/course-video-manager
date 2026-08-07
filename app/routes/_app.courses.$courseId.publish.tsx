import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { UploadContext } from "@/features/upload-manager/upload-context";
import {
  parseSemver,
  formatSemver,
  bumpSemver,
  ZERO_SEMVER,
  type BumpLevel,
} from "@/lib/semver";
import { LESSON_WARNING_LABELS } from "@/features/course-view/lesson-warning-labels";
import { VIDEO_WARNING_LABELS } from "@/features/course-view/video-warning-labels";
import { CoursePublishService } from "@/services/course-publish-service";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  classifyPendingRecovery,
  type PendingRecovery,
} from "@/services/pending-recovery.server";
import { makeAction, makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArrowLeft, AlertTriangle, ChevronRight } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { data, Link, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.publish";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const publishService = yield* CoursePublishService;

      const [course, allVersions] = yield* Effect.all(
        [
          courseOps.getCourseById(params.courseId!),
          versionOps.getAllVersionsWithStructure(params.courseId!),
        ],
        { concurrency: "unbounded" }
      );

      const latestVersion = allVersions[0];
      if (!latestVersion) {
        return yield* Effect.die(data("No version found", { status: 404 }));
      }

      // Get previous published version name (allVersions is sorted newest first)
      const previousVersion = allVersions.length > 1 ? allVersions[1] : null;

      // Validation is computed for BOTH toggle positions in a single pass so the
      // publish page can flip instantly with no server round-trip. `withTodo` is
      // the default (everything ships); `withoutTodo` is what ships when to-do
      // Lessons are withheld.
      const { withTodo, withoutTodo } =
        yield* publishService.validatePublishability(latestVersion.id);

      // Reconcile-on-load (#1404): detect a crash-stranded Pending Version and
      // classify it against the Dropbox course.json receipt. Read-only — the
      // Promote / Discard transitions run in this route's action.
      const pendingRecovery = yield* classifyPendingRecovery({
        courseId: params.courseId!,
        courseName: course.name,
      });

      const { sections: _, ...latestVersionMeta } = latestVersion;
      return {
        course,
        pendingRecovery,
        latestVersion: latestVersionMeta,
        previousVersionName: previousVersion?.name ?? null,
        withTodo: {
          courseViewLintCount: withTodo.courseViewLintCount,
          courseViewLints: withTodo.courseViewLints,
          invalidLessonCombos: withTodo.invalidLessonCombos,
          incompleteVideos: withTodo.incompleteVideos,
        },
        withoutTodo: {
          courseViewLintCount: withoutTodo.courseViewLintCount,
          courseViewLints: withoutTodo.courseViewLints,
          invalidLessonCombos: withoutTodo.invalidLessonCombos,
          incompleteVideos: withoutTodo.incompleteVideos,
        },
      };
    }),
});

/**
 * The Promote / Discard transitions for a crash-stranded Pending Version
 * (#1404). Both lifecycle verbs act only on a `pending` row (compare-and-set
 * in the DB), so a stale banner or double-click cannot touch a Draft or
 * Published Version — it just gets a 409.
 */
export const action = makeAction({
  input: "formData",
  errors: { VersionNotPendingError: 409 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { intent, versionId } = payload as {
        intent?: unknown;
        versionId?: unknown;
      };
      if (typeof versionId !== "string" || versionId === "") {
        return yield* Effect.die(data("Missing versionId", { status: 400 }));
      }
      const versionOps = yield* VersionOperationsService;
      if (intent === "promote-pending") {
        const promoted = yield* versionOps.promotePendingVersion(versionId);
        return { promotedVersionId: promoted.id };
      }
      if (intent === "discard-pending") {
        const discarded = yield* versionOps.discardPendingVersion(versionId);
        return { discardedVersionId: discarded.id };
      }
      return yield* Effect.die(data("Unknown intent", { status: 400 }));
    }),
});

export default function Component(props: Route.ComponentProps) {
  const {
    course,
    pendingRecovery,
    previousVersionName,
    withTodo,
    withoutTodo,
  } = props.loaderData;
  const navigate = useNavigate();
  const { uploads, startPublish } = useContext(UploadContext);

  // The version name is never free-typed: it is a lowercase-'v' semver computed
  // from the previous published version by a patch/minor/major bump, so the UI
  // can only ever produce a valid semver (matching the CLI's contract). A
  // non-semver previous name (or a first-ever publish) falls back to v0.0.0.
  const { baseSemver, previousWasSemver } = useMemo(() => {
    if (!previousVersionName)
      return { baseSemver: ZERO_SEMVER, previousWasSemver: true };
    const parsed = parseSemver(previousVersionName);
    return {
      baseSemver: parsed ?? ZERO_SEMVER,
      previousWasSemver: parsed !== null,
    };
  }, [previousVersionName]);

  const [bumpLevel, setBumpLevel] = useState<BumpLevel>("patch");
  const name = formatSemver(bumpSemver(baseSemver, bumpLevel));
  const [description, setDescription] = useState("");
  const [includeTodoLessons, setIncludeTodoLessons] = useState(true);
  const [publishStarted, setPublishStarted] = useState(false);

  const hasActivePublish = Object.values(uploads).some(
    (u) =>
      u.uploadType === "publish" &&
      (u.status === "uploading" ||
        u.status === "waiting" ||
        u.status === "retrying")
  );
  const isOperationInProgress = hasActivePublish;

  useFocusRevalidate({ enabled: !publishStarted });

  // The warnings and the publish button reflect whichever toggle position is
  // currently selected — flipping the toggle switches them instantly, with no
  // server round-trip.
  const effective = includeTodoLessons ? withTodo : withoutTodo;
  const courseViewLintCount = effective.courseViewLintCount;
  const courseViewLints = effective.courseViewLints;
  const invalidLessonCombos = effective.invalidLessonCombos;
  const incompleteVideos = effective.incompleteVideos;

  const hasCourseViewLints = courseViewLintCount > 0;
  const hasInvalidLessonCombos = invalidLessonCombos.length > 0;
  const hasIncompleteVideos = incompleteVideos.length > 0;
  const canPublish =
    description.trim().length > 0 &&
    !hasCourseViewLints &&
    !hasInvalidLessonCombos &&
    !hasIncompleteVideos &&
    !publishStarted &&
    !isOperationInProgress &&
    // A stranded Pending Version blocks publishing until reconciled — a second
    // Submit would collide with the at-most-one-pending invariant anyway.
    pendingRecovery === null;

  const handlePublish = useCallback(() => {
    setPublishStarted(true);
    startPublish(
      course.id,
      course.name,
      name,
      description.trim(),
      includeTodoLessons
    );
    // Navigate back to course — progress shows in GlobalUploadProgress
    navigate(`/courses/${course.id}`);
  }, [
    course.id,
    course.name,
    name,
    description,
    includeTodoLessons,
    startPublish,
    navigate,
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6">
          <Link to={`/courses/${course.id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {course.name}
            </Button>
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">Publish {course.name}</h1>

        {/* Reconcile-on-load banner (#1404). Suppressed while a publish from
            this client is live — its Pending Version is in flight, not
            stranded, and the publish process will Promote or Discard itself. */}
        {!hasActivePublish && (
          <PendingRecoveryBanner recovery={pendingRecovery} />
        )}

        {previousVersionName && (
          <p className="text-sm text-muted-foreground mb-6">
            {previousVersionName} <ChevronRight className="inline w-3 h-3" />{" "}
            {name}
          </p>
        )}

        {/* Publish Form */}
        <div className="space-y-4 mb-8">
          <div className="space-y-2">
            <Label>Version</Label>
            <div className="flex items-center gap-3">
              <span className="text-lg font-mono font-semibold">{name}</span>
              <div className="flex gap-1">
                {(["patch", "minor", "major"] as const).map((level) => (
                  <Button
                    key={level}
                    variant={bumpLevel === level ? "default" : "outline"}
                    size="sm"
                    onClick={() => setBumpLevel(level)}
                    disabled={publishStarted}
                    className="capitalize"
                  >
                    {level}
                  </Button>
                ))}
              </div>
            </div>
            {previousVersionName && (
              <p className="text-xs text-muted-foreground">
                Previous: {previousVersionName}
                {!previousWasSemver && " (not semver — starting from v0)"}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="version-description">Description *</Label>
            <Textarea
              id="version-description"
              placeholder="Describe what changed in this version..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={publishStarted}
              rows={3}
            />
          </div>
        </div>

        {/* Include to-do lessons toggle */}
        <div className="mb-8 rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="include-todo"
              checked={includeTodoLessons}
              onCheckedChange={(checked) =>
                setIncludeTodoLessons(checked === true)
              }
              disabled={publishStarted}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="include-todo" className="font-medium">
                Include lessons marked to-do
              </Label>
              <p className="text-sm text-muted-foreground">
                {includeTodoLessons
                  ? "Every lesson will publish — including lessons still marked to-do, which may be unreviewed. They are exported, mirrored to the team's Dropbox, and listed in course.json exactly like finished lessons."
                  : "Lessons still marked to-do are withheld from this publish: omitted from the current course.json and its immutable Dropbox bundle. Earlier bundles stay intact for rollback. Sections left with no remaining lessons disappear from the current manifest. Nothing is lost because every lesson stays saved in full in the Published Version, and turning this back on and republishing restores it."}
              </p>
            </div>
          </div>
        </div>

        {/* Course-view Lints — each warning is listed (not just counted) so it
            can be found and fixed in the course view. The label wording matches
            the course view exactly, keeping the two surfaces in lockstep. */}
        {hasCourseViewLints && (
          <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">
                {courseViewLintCount} course warning
                {courseViewLintCount !== 1 ? "s" : ""} — fix in the course view
                before publishing
              </span>
            </div>
            <ul className="space-y-1.5">
              {courseViewLints.map((lint, index) =>
                lint.scope === "course" ? (
                  <li
                    key={`course/${lint.quizId}/${index}`}
                    className="text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {lint.quizId}
                    </span>{" "}
                    <span className="text-amber-500">
                      ({VIDEO_WARNING_LABELS[lint.kind]})
                    </span>
                    <span className="block text-muted-foreground/70">
                      {lint.videoPaths.join(" · ")}
                    </span>
                  </li>
                ) : (
                  <li
                    key={`${lint.sectionPath}/${lint.lessonPath}/${
                      lint.scope === "video" ? lint.videoTitle : "lesson"
                    }/${lint.kind}/${index}`}
                    className="text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {lint.scope === "video"
                        ? lint.videoTitle
                        : lint.lessonPath || "Lesson"}
                    </span>{" "}
                    <span className="text-amber-500">
                      (
                      {lint.scope === "video"
                        ? VIDEO_WARNING_LABELS[lint.kind]
                        : LESSON_WARNING_LABELS[lint.kind]}
                      )
                    </span>
                    <span className="block text-muted-foreground/70">
                      {lint.sectionPath}
                      {lint.scope === "video" && lint.lessonPath
                        ? ` / ${lint.lessonPath}`
                        : ""}
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>
        )}

        {/* Incomplete Videos — a shipping video missing clips, body, or
            description. Every field in course.json is required, so publishing
            one would fail the build; block it here (see ADR 0019). */}
        {hasIncompleteVideos && (
          <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">
                {incompleteVideos.length} incomplete video
                {incompleteVideos.length !== 1 ? "s" : ""} — finish{" "}
                {incompleteVideos.length !== 1 ? "these" : "this"} before
                publishing
              </span>
            </div>
            <ul className="space-y-1.5">
              {incompleteVideos.map((video) => (
                <li
                  key={`${video.sectionPath}/${video.lessonPath}/${video.videoTitle}`}
                  className="text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {video.videoTitle}
                  </span>{" "}
                  <span className="text-amber-500">
                    (missing {video.missing.join(", ")})
                  </span>
                  <span className="block text-muted-foreground/70">
                    {video.sectionPath} / {video.lessonPath}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Invalid Lesson Role Combos — a lesson whose videos don't form a valid
            explainer / problem / solution combo. buildCourseJson can't resolve
            it, so block publish until the roles are fixed in the course view. */}
        {hasInvalidLessonCombos && (
          <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">
                {invalidLessonCombos.length} lesson
                {invalidLessonCombos.length !== 1 ? "s" : ""} with an invalid
                video combo — fix in the course view before publishing
              </span>
            </div>
            <ul className="space-y-1.5">
              {invalidLessonCombos.map((lesson) => (
                <li
                  key={`${lesson.sectionPath}/${lesson.lessonPath}`}
                  className="text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {lesson.lessonPath}
                  </span>{" "}
                  <span className="text-amber-500">
                    ({lesson.videoTitles.join(", ")})
                  </span>
                  <span className="block text-muted-foreground/70">
                    {lesson.sectionPath}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Publish Button */}
        <div className="mb-8">
          <Button
            onClick={handlePublish}
            disabled={!canPublish}
            className="w-full"
            size="lg"
          >
            {hasActivePublish ? "Publishing..." : "Publish"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The durable recovery surface for a crash-stranded Pending Version (#1404).
 * Receipt committed → the publish is already live externally, so Promote is
 * auto-submitted on render (never discard a committed version) and the banner
 * confirms recovery. Receipt absent → one-click Discard; the operator's edits
 * are safe in the current Draft and they republish normally.
 */
function PendingRecoveryBanner({
  recovery,
}: {
  recovery: PendingRecovery | null;
}) {
  const fetcher = useFetcher();
  const promoteSubmitted = useRef(false);
  // Held locally so the "recovered ✓" confirmation survives the revalidation
  // that clears `recovery` after the Promote lands.
  const [recoveredName, setRecoveredName] = useState<string | null>(null);

  useEffect(() => {
    if (recovery?.receiptState === "committed" && !promoteSubmitted.current) {
      promoteSubmitted.current = true;
      setRecoveredName(recovery.versionName);
      fetcher.submit(
        { intent: "promote-pending", versionId: recovery.versionId },
        { method: "post" }
      );
    }
  }, [recovery, fetcher]);

  if (recoveredName !== null) {
    // Recovered only once the Promote actually landed — an errored action
    // must not read as success.
    const done =
      fetcher.state === "idle" &&
      (fetcher.data as { promotedVersionId?: string } | undefined)
        ?.promotedVersionId !== undefined;
    return (
      <div className="mb-8 rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-sm">
        <span className="font-medium text-green-500">
          {done
            ? `Publish finished — recovered ✓ ${recoveredName} is live.`
            : `Finalizing your interrupted publish of ${recoveredName}…`}
        </span>
        <p className="text-muted-foreground mt-1">
          The last publish committed to Dropbox but was interrupted before it
          was recorded here.{" "}
          {done ? "It is now marked Published." : "Marking it Published…"}
        </p>
      </div>
    );
  }

  if (!recovery) return null;

  if (recovery.receiptState === "unreadable") {
    // Never offer Discard on a receipt we could not read — the mount may be
    // down while the receipt (and a committed publish) actually exists.
    return (
      <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-medium text-amber-500">
            An interrupted publish ({recovery.versionName}) needs recovery
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          The Dropbox commit receipt (course.json) couldn&apos;t be read, so it
          is unknown whether that publish committed. Check the Dropbox mount and
          reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-amber-500" />
        <span className="text-sm font-medium text-amber-500">
          Your last publish ({recovery.versionName}) didn&apos;t finish
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        It never committed — the course.json receipt was never written, so
        consumers still see the previous release. Your edits are safe in the
        current draft. Discard the unfinished version, then publish again
        normally.
      </p>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="discard-pending" />
        <input type="hidden" name="versionId" value={recovery.versionId} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={fetcher.state !== "idle"}
        >
          {fetcher.state !== "idle"
            ? "Discarding…"
            : "Discard unfinished publish"}
        </Button>
      </fetcher.Form>
    </div>
  );
}
