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
import { CoursePublishService } from "@/services/course-publish-service";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArrowLeft, AlertTriangle, ChevronRight } from "lucide-react";
import { useCallback, useContext, useMemo, useState } from "react";
import { data, Link, useNavigate } from "react-router";
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

      const { sections: _, ...latestVersionMeta } = latestVersion;
      return {
        course,
        latestVersion: latestVersionMeta,
        previousVersionName: previousVersion?.name ?? null,
        withTodo: {
          courseViewLintCount: withTodo.courseViewLintCount,
          invalidLessonCombos: withTodo.invalidLessonCombos,
          incompleteVideos: withTodo.incompleteVideos,
        },
        withoutTodo: {
          courseViewLintCount: withoutTodo.courseViewLintCount,
          invalidLessonCombos: withoutTodo.invalidLessonCombos,
          incompleteVideos: withoutTodo.incompleteVideos,
        },
      };
    }),
});

export default function Component(props: Route.ComponentProps) {
  const { course, previousVersionName, withTodo, withoutTodo } =
    props.loaderData;
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
    !isOperationInProgress;

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
                  : "Lessons still marked to-do are withheld from this publish: omitted from course.json, not exported, and not mirrored to Dropbox. Any to-do lesson already in the team's Dropbox is removed, and sections left with no remaining lessons disappear. Nothing is lost — every lesson stays saved in full in the Published Version, and turning this back on and republishing restores it."}
              </p>
            </div>
          </div>
        </div>

        {/* Course-view Lints */}
        {hasCourseViewLints && (
          <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">
                {courseViewLintCount} course warning
                {courseViewLintCount !== 1 ? "s" : ""} — fix in the course view
                before publishing
              </span>
            </div>
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
