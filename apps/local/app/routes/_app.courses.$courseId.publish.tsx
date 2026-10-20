import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { isFinishedJob } from "@/features/jobs/jobs-reducer";
import { latestJobFor } from "@/features/jobs/jobs-selectors";
import { decidePublishAction } from "@/features/publish/publish-action";
import {
  AutofillSkipList,
  countBlockers,
  PublishBlockers,
  splitAutofillClearable,
} from "@/features/publish/publish-blockers";
import { PendingRecoveryBanner } from "@/features/publish/pending-recovery-banner";
import { PlaceholderFloorPanel } from "@/features/publish/placeholder-floor-panel";
import {
  readVersionBase,
  selectVersionName,
} from "@/features/publish/publish-page-reducer";
import { usePublishPageReducer } from "@/features/publish/use-publish-page-reducer";
import { placeholderFloorStorageKey } from "@/features/publish/placeholder-floor";
import {
  ANNOUNCE_NOTHING_BAND,
  PLACEHOLDER_FLOOR_BANDS,
  placeholderFloorFromBand,
  type PlaceholderFloorBand,
} from "@/packages/course-json/client";
import {
  collectLessonPublishStatuses,
  type LessonPublishStatuses,
} from "@/services/course-publish-lesson-statuses";
import { useLocalStorageOneOf } from "@/hooks/use-local-storage";
import { selectAutofillCandidates } from "@/services/autofill-candidates";
import { CoursePublishReadService } from "@/services/course-publish-reads";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { classifyPendingRecovery } from "@/services/pending-recovery.server";
import { makeAction, makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useContext, useEffect, useMemo } from "react";
import { data, Link } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.publish";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;
      const publishService = yield* CoursePublishReadService;

      const [course, allVersions] = yield* Effect.all(
        [
          courseOps.getCourseById(params.courseId!),
          // Metadata only: the page reads the latest Version's id and meta and
          // the previous Version's name. Loading every Version's full tree
          // (every Clip and Chapter of every past release) here cost seconds
          // and grew with each publish.
          versionOps.getCourseVersions(params.courseId!),
        ],
        { concurrency: "unbounded" }
      );

      const latestVersion = allVersions[0];
      if (!latestVersion) {
        return yield* Effect.die(data("No version found", { status: 404 }));
      }

      // Get previous published version name (allVersions is sorted newest first)
      const previousVersion = allVersions.length > 1 ? allVersions[1] : null;

      // One read of the latest Version's tree, shared by the validation gate
      // and by the Autofill and lesson statuses below.
      const versionTree = yield* versionOps.getVersionWithSections(
        latestVersion.id
      );
      // Validation is computed for BOTH toggle positions in a single pass so the
      // publish page can flip instantly with no server round-trip. `withTodo` is
      // the default (everything ships); `withoutTodo` is what ships when to-do
      // Lessons are withheld.
      const { withTodo, withoutTodo } =
        yield* publishService.validatePublishabilityOfTree(versionTree);

      // The Autofill's candidate rule, read for BOTH toggle positions on the
      // same terms as the readiness lists — so what the page says Publish will
      // fill in first is the same rule the run itself uses (see selectAutofillCandidates). Deliberately
      // NOT folded into Publish Readiness: the Autofill is a UI-only feature
      // for now, and `cvm course readiness` must not grow a field for it.
      const autofillWithTodo = selectAutofillCandidates(
        versionTree.sections,
        true
      );
      const autofillWithoutTodo = selectAutofillCandidates(
        versionTree.sections,
        false
      );

      // THE PLACEHOLDER FLOOR, PRECOMPUTED AT EVERY POSITION.
      //
      // The floor is one value per `validatePublishability` call, and that call
      // carries an `exists()` per shipping Video — far too expensive to repeat
      // eight times just so a control can flip. But the floor decides ONLY the
      // Lesson Publish Status lists, and those come from a pure, filesystem-free
      // walk of the tree this loader already holds. So the floor loop is hoisted
      // here instead: two to-do settings × four bands, from one tree read, and
      // moving the control costs nothing. It is the same walk
      // `validatePublishability` and `buildCourseJson` read, so the cards and
      // the release can never disagree.
      const lessonStatusesByBand = (includeTodoLessons: boolean) =>
        Object.fromEntries(
          PLACEHOLDER_FLOOR_BANDS.map((band) => [
            band,
            collectLessonPublishStatuses(versionTree.sections, {
              includeTodoLessons,
              placeholderFloor: placeholderFloorFromBand(band),
            }),
          ])
        ) as Record<PlaceholderFloorBand, LessonPublishStatuses>;

      // Reconcile-on-load (#1404): detect a crash-stranded Pending Version and
      // classify it against the Dropbox course.json receipt. Read-only — the
      // Promote / Discard transitions run in this route's action.
      const pendingRecovery = yield* classifyPendingRecovery({
        courseId: params.courseId!,
        courseName: course.name,
      });

      const latestVersionMeta = {
        id: latestVersion.id,
        name: latestVersion.name,
        description: latestVersion.description,
        commitState: latestVersion.commitState,
        createdAt: latestVersion.createdAt,
      };
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
          lessonStatusesByBand: lessonStatusesByBand(true),
        },
        withoutTodo: {
          courseViewLintCount: withoutTodo.courseViewLintCount,
          courseViewLints: withoutTodo.courseViewLints,
          invalidLessonCombos: withoutTodo.invalidLessonCombos,
          incompleteVideos: withoutTodo.incompleteVideos,
          autofill: autofillWithoutTodo,
          lessonStatusesByBand: lessonStatusesByBand(false),
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
  const { jobs } = useContext(UploadContext);
  const { state, dispatch } = usePublishPageReducer();
  const { bumpLevel, description, includeTodoLessons, publishStarted } = state;

  const { baseSemver, previousWasSemver } = useMemo(
    () => readVersionBase(previousVersionName),
    [previousVersionName]
  );
  const name = selectVersionName(state, baseSemver);
  // The floor, unlike the to-do toggle, is remembered — per Course, so an
  // unlaunched Course and a shipped one never share one setting — and it
  // defaults to announcing nothing, so the first release after this lands
  // behaves exactly as one before it.
  const [floorBand, setFloorBand] = useLocalStorageOneOf<PlaceholderFloorBand>(
    placeholderFloorStorageKey(course.id),
    PLACEHOLDER_FLOOR_BANDS,
    ANNOUNCE_NOTHING_BAND
  );

  // This Course's Publish, a Job the Sidecar runs: one started in this tab,
  // or one still running when the tab was reopened, holds the button and
  // hides the Promote / Discard banner — its Pending Version is in flight,
  // not stranded. Once it is interrupted, the banner is the way out.
  const publishJob = latestJobFor(jobs, "publish", course.id);
  const hasActivePublish = !!publishJob && !isFinishedJob(publishJob);
  // This Course's Autofill, the hidden first step of a Publish: a Job the
  // Sidecar runs, with the Publish queued behind it. One still running when
  // the tab was reopened holds the button too.
  const autofillJob = latestJobFor(jobs, "autofill", course.id);
  const hasActiveAutofill = !!autofillJob && !isFinishedJob(autofillJob);

  useFocusRevalidate({ enabled: !publishStarted });

  // Bridge: report this Course's Publish Job to the reducer, which re-reads
  // Publish Readiness when it settles.
  useEffect(() => {
    dispatch({ type: "publish-job-observed", running: hasActivePublish });
  }, [hasActivePublish, dispatch]);

  // The warnings and the publish button reflect whichever toggle position is
  // currently selected — flipping the toggle switches them instantly, with no
  // server round-trip.
  const effective = includeTodoLessons ? withTodo : withoutTodo;
  const courseViewLints = effective.courseViewLints;
  const invalidLessonCombos = effective.invalidLessonCombos;
  const incompleteVideos = effective.incompleteVideos;
  // Autofill is untouched by the floor: its candidates are still the shipping
  // Videos missing a description or chapters, so Publish still fills them in
  // on a pre-launch Course.
  const autofill = effective.autofill;
  const lessonStatuses = effective.lessonStatusesByBand[floorBand];
  const blockerLists = {
    courseViewLints,
    incompleteVideos,
    invalidLessonCombos,
  };
  // Only what the Autofill leaves behind blocks the button: the rest is the
  // hidden first step of the Publish itself.
  const remainingBlockers = countBlockers(
    splitAutofillClearable(blockerLists, autofill.candidates).mine
  );

  // The rule lives in a pure function so it can be tested without rendering
  // this page.
  const action = decidePublishAction({
    pendingRecovery: pendingRecovery !== null,
    hasBlockers: remainingBlockers > 0,
    hasVersionDescription: description.trim().length > 0,
    autofillRunning: hasActiveAutofill,
    publishRunning: hasActivePublish || publishStarted,
  });

  const hasAutofillWork = autofill.candidates.length > 0;
  const handlePublish = () =>
    dispatch({
      type: "publish-clicked",
      context: {
        courseId: course.id,
        courseName: course.name,
        versionId: latestVersion.id,
        baseSemver,
        placeholders: floorBand,
        hasAutofillWork,
      },
    });

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

        {/* Reconcile-on-load banner (#1404). Suppressed while this Course's
            Publish Job is live — its Pending Version is in flight, not
            stranded, and the Publish will Promote or Discard itself. An
            interrupted Publish is never re-run on its own (plan §7.2): this
            banner is where its Pending Version is reconciled, by hand. */}
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
                    onClick={() =>
                      dispatch({ type: "bump-level-clicked", level })
                    }
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
              onChange={(e) =>
                dispatch({
                  type: "description-edited",
                  description: e.target.value,
                })
              }
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
                dispatch({
                  type: "include-todo-toggled",
                  checked: checked === true,
                })
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

        <PlaceholderFloorPanel
          band={floorBand}
          onBandChange={setFloorBand}
          disabled={publishStarted}
          statuses={lessonStatuses}
        />

        <PublishBlockers
          lists={blockerLists}
          candidates={autofill.candidates}
        />

        {/* One press: Publish fills in what the Autofill can first, then
            publishes. */}
        {action.kind !== "hidden" && (
          <div className="mb-8 space-y-2">
            <Button
              onClick={handlePublish}
              disabled={!action.enabled}
              className="w-full"
              size="lg"
            >
              {action.label}
            </Button>
            {hasAutofillWork && (
              <p className="text-xs text-muted-foreground">
                Publishing first fills in the missing SEO descriptions and
                chapters of {autofill.candidates.length}{" "}
                {autofill.candidates.length === 1 ? "video" : "videos"}. It
                never overwrites what you wrote.
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
