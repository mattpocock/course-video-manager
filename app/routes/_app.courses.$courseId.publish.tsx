import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { hasActiveExportUploads } from "@/features/upload-manager/export-status";
import { generateChangelog } from "@/services/changelog-service";
import { CoursePublishService } from "@/services/course-publish-service";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { ArrowLeft, Download, AlertCircle, ChevronRight } from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { data, Link, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.publish";

export const loader = async (args: Route.LoaderArgs) => {
  const { courseId } = args.params;

  return Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;
    const publishService = yield* CoursePublishService;

    const [course, allVersions] = yield* Effect.all(
      [
        courseOps.getCourseById(courseId),
        versionOps.getAllVersionsWithStructure(courseId),
      ],
      { concurrency: "unbounded" }
    );

    const latestVersion = allVersions[0];
    if (!latestVersion) {
      return yield* Effect.die(data("No version found", { status: 404 }));
    }

    // Get changelog preview (treat draft as if it were published with a placeholder name)
    const changelogVersions = allVersions.map((v) =>
      v.id === latestVersion.id
        ? { ...v, name: "(Draft — pending publish)" }
        : v
    );
    const changelog = generateChangelog(changelogVersions);

    // Get previous published version name (allVersions is sorted newest first)
    const previousVersion = allVersions.length > 1 ? allVersions[1] : null;

    // Get unexported videos
    const { unexportedVideoIds } = yield* publishService.validatePublishability(
      latestVersion.id
    );

    const { sections: _, ...latestVersionMeta } = latestVersion;
    return {
      course,
      latestVersion: latestVersionMeta,
      previousVersionName: previousVersion?.name ?? null,
      changelog,
      unexportedVideoCount: unexportedVideoIds.length,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Course not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const {
    course,
    latestVersion,
    previousVersionName,
    changelog,
    unexportedVideoCount,
  } = props.loaderData;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { uploads, startBatchExportUpload, startPublish } =
    useContext(UploadContext);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [publishStarted, setPublishStarted] = useState(false);

  const hasActiveExport = hasActiveExportUploads(uploads);
  const hasActivePublish = Object.values(uploads).some(
    (u) =>
      u.uploadType === "publish" &&
      (u.status === "uploading" ||
        u.status === "waiting" ||
        u.status === "retrying")
  );
  const isOperationInProgress = hasActiveExport || hasActivePublish;

  useFocusRevalidate({ enabled: !publishStarted });

  const prevHadActiveExportRef = useRef(false);
  useEffect(() => {
    if (prevHadActiveExportRef.current && !hasActiveExport) {
      revalidator.revalidate();
    }
    prevHadActiveExportRef.current = hasActiveExport;
  }, [hasActiveExport, revalidator]);

  const hasUnexportedVideos = unexportedVideoCount > 0;
  const canPublish =
    name.trim().length > 0 &&
    !hasUnexportedVideos &&
    !publishStarted &&
    !isOperationInProgress;

  const handleExportAll = useCallback(() => {
    startBatchExportUpload(latestVersion.id);
  }, [latestVersion.id, startBatchExportUpload]);

  const handlePublish = useCallback(() => {
    setPublishStarted(true);
    startPublish(course.id, course.name, name.trim(), description.trim());
    // Navigate back to course — progress shows in GlobalUploadProgress
    navigate(`/courses/${course.id}`);
  }, [course.id, course.name, name, description, startPublish, navigate]);

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
            {name.trim() || <span className="italic">New Version</span>}
          </p>
        )}

        {/* Publish Form */}
        <div className="space-y-4 mb-8">
          <div className="space-y-2">
            <Label htmlFor="version-name">Version Name *</Label>
            <Input
              id="version-name"
              placeholder='e.g. "v2.1 — Added auth module"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={publishStarted}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="version-description">Description</Label>
            <Textarea
              id="version-description"
              placeholder="Optional description of what changed..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={publishStarted}
              rows={3}
            />
          </div>
        </div>

        {/* Unexported Videos */}
        {hasUnexportedVideos && (
          <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span className="text-sm font-medium text-amber-500">
                  {unexportedVideoCount} unexported video
                  {unexportedVideoCount !== 1 ? "s" : ""}
                </span>
              </div>
              <Button
                size="sm"
                onClick={handleExportAll}
                disabled={isOperationInProgress}
              >
                <Download className="w-3 h-3 mr-1" />
                {hasActiveExport ? "Exporting..." : "Export All"}
              </Button>
            </div>
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
            {hasActivePublish
              ? "Publishing..."
              : hasActiveExport
                ? "Export in progress..."
                : "Publish"}
          </Button>
        </div>

        {/* Changelog Preview */}
        <div className="border-t border-border pt-6">
          <h2 className="text-lg font-semibold mb-4">Changelog Preview</h2>
          <div className="prose dark:prose-invert max-w-none">
            <Markdown rehypePlugins={[rehypeRaw]}>{changelog}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
