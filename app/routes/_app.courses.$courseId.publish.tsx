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
import { decidePublishAction } from "@/features/publish/publish-action";
import {
  AutofillSkipList,
  PublishBlockers,
} from "@/features/publish/publish-blockers";
import { PendingRecoveryBanner } from "@/features/publish/pending-recovery-banner";
import { selectAutofillCandidates } from "@/services/autofill-candidates";
import { CoursePublishService } from "@/services/course-publish-service";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { classifyPendingRecovery } from "@/services/pending-recovery.server";
import { makeAction, makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArrowLeft, ChevronRight, Sparkles } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { data, Link, useNavigate, useRevalidator } from "react-router";
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

      // The Autofill's candidate rule, read for BOTH toggle positions on the
      // same terms as the readiness lists — so the button's count is the same
      // rule the run itself uses (see selectAutofillCandidates). Deliberately
      // NOT folded into Publish Readiness: the Autofill is a UI-only feature
      // for now, and `cvm course readiness` must not grow a field for it.
      const versionTree = yield* versionOps.getVersionWithSections(
        latestVersion.id
      );
      const autofillWithTodo = selectAutofillCandidates(
        versionTree.sections,
        true
      );
      const autofillWithoutTodo = selectAutofillCandidates(
        versionTree.sections,
        false
      );

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
          autofill: autofillWithTodo,
        },
        withoutTodo: {
          courseViewLintCount: withoutTodo.courseViewLintCount,
          courseViewLints: withoutTodo.courseViewLints,
          invalidLessonCombos: withoutTodo.invalidLessonCombos,
          incompleteVideos: withoutTodo.incompleteVideos,
          autofill: autofillWithoutTodo,
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
    latestVersion,
    withTodo,
    withoutTodo,
  } = props.loaderData;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { uploads, startPublish, startAutofill } = useContext(UploadContext);

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

  const [autofillUploadId, setAutofillUploadId] = useState<string | null>(null);

  const isLive = (status: string) =>
    status === "uploading" || status === "waiting" || status === "retrying";

  const hasActivePublish = Object.values(uploads).some(
    (u) => u.uploadType === "publish" && isLive(u.status)
  );
  // Only THIS page's run: an Autofill started elsewhere is watched in the
  // upload surface, not held against this button.
  const activeAutofill = autofillUploadId
    ? uploads[autofillUploadId]
    : undefined;
  const hasActiveAutofill = !!activeAutofill && isLive(activeAutofill.status);

  useFocusRevalidate({ enabled: !publishStarted });

  // When the run settles the page re-reads Publish Readiness and re-evaluates
  // the button — which is how the same button comes back reading "Publish".
  // It never rolls on into a Publish: the second press is the author's.
  useEffect(() => {
    if (!activeAutofill || isLive(activeAutofill.status)) return;
    setAutofillUploadId(null);
    revalidator.revalidate();
  }, [activeAutofill, revalidator]);

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
  const autofill = effective.autofill;

  // One button, two labels. The rule lives in a pure function so it can be
  // tested across its four cases without rendering this page.
  const action = decidePublishAction({
    pendingRecovery: pendingRecovery !== null,
    autofillCandidateCount: autofill.candidates.length,
    hasBlockers:
      hasCourseViewLints || hasInvalidLessonCombos || hasIncompleteVideos,
    hasVersionDescription: description.trim().length > 0,
    autofillRunning: hasActiveAutofill,
    publishRunning: hasActivePublish || publishStarted,
  });

  const handleAutofill = useCallback(() => {
    setAutofillUploadId(
      startAutofill(
        course.id,
        course.name,
        latestVersion.id,
        includeTodoLessons
      )
    );
  }, [
    course.id,
    course.name,
    latestVersion.id,
    includeTodoLessons,
    startAutofill,
  ]);

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

        <PublishBlockers
          lists={{
            courseViewLints,
            incompleteVideos,
            invalidLessonCombos,
          }}
          candidates={autofill.candidates}
        />

        {/* One button, two labels: "Autofill N Videos" while the Autofill has
            work, "Publish" once it does not. It never rolls on from one to the
            other — pressing Autofill and walking away is the point, and the
            second press happens after the readiness lists have been re-read. */}
        {action.kind !== "hidden" && (
          <div className="mb-8 space-y-2">
            <Button
              onClick={
                action.kind === "autofill" ? handleAutofill : handlePublish
              }
              disabled={!action.enabled}
              className="w-full"
              size="lg"
            >
              {action.kind === "autofill" && (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {action.label}
            </Button>
            {action.kind === "autofill" && (
              <p className="text-xs text-muted-foreground">
                Fills in every missing SEO description and set of chapters.
                Watch it in the upload panel — it stops when it is done, and you
                press Publish yourself.
              </p>
            )}
            {autofill.skipped.length > 0 && (
              <AutofillSkipList skipped={autofill.skipped} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
