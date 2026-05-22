import { Button } from "@/components/ui/button";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useState } from "react";
import { data, Link } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.versions.$versionId.media-files";

export const loader = async (args: Route.LoaderArgs) => {
  const { courseId: repoId, versionId } = args.params;

  return Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;

    const [version, repoWithSections] = yield* Effect.all(
      [
        versionOps.getCourseVersionById(versionId),
        versionOps.getCourseWithSectionsByVersionSlim({ repoId, versionId }),
      ],
      { concurrency: "unbounded" }
    );

    return {
      repo: repoWithSections,
      version,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const { repo, version } = props.loaderData;
  const [copied, setCopied] = useState(false);

  useFocusRevalidate({ enabled: true });

  // Collect all videoFilenames from clips
  const allPaths: string[] = [];
  for (const section of repo.sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        for (const clip of video.clips) {
          if (clip.videoFilename) {
            allPaths.push(clip.videoFilename);
          }
        }
      }
    }
  }

  // Deduplicated paths for copying
  const uniquePaths = [...new Set(allPaths)];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(uniquePaths.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6 flex items-center justify-between">
          <Link to={`/courses/${repo.id}?versionId=${version.id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {repo.name}
            </Button>
          </Link>

          <Button onClick={handleCopy} variant="outline" size="sm">
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copy All Paths ({uniquePaths.length})
              </>
            )}
          </Button>
        </div>

        <h1 className="text-2xl font-bold mb-2">Media Files</h1>
        <p className="text-muted-foreground mb-6">
          {repo.name} — {version.name}
        </p>

        {repo.sections.length === 0 ? (
          <p className="text-muted-foreground">No sections in this version.</p>
        ) : (
          <div className="space-y-6">
            {repo.sections.map((section) => {
              const sectionHasClips = section.lessons.some((l) =>
                l.videos.some((v) => v.clips.length > 0)
              );
              if (!sectionHasClips) return null;

              return (
                <div key={section.id}>
                  <h2 className="text-lg font-semibold mb-3 text-muted-foreground">
                    {section.path}
                  </h2>
                  <div className="space-y-4 pl-4">
                    {section.lessons.map((lesson) => {
                      const lessonHasClips = lesson.videos.some(
                        (v) => v.clips.length > 0
                      );
                      if (!lessonHasClips) return null;

                      return (
                        <div key={lesson.id}>
                          <h3 className="text-sm font-medium mb-2">
                            {lesson.path}
                          </h3>
                          <div className="space-y-2 pl-4">
                            {lesson.videos.map((video) => {
                              if (video.clips.length === 0) return null;

                              const videoFilenames = video.clips
                                .filter((c) => c.videoFilename)
                                .map((c) => c.videoFilename);
                              const uniqueVideoFilenames = [
                                ...new Set(videoFilenames),
                              ];

                              if (uniqueVideoFilenames.length === 0)
                                return null;

                              return (
                                <div key={video.id}>
                                  <p className="text-xs text-muted-foreground mb-1">
                                    {video.path.split("/").pop()}
                                  </p>
                                  <ul className="pl-4 space-y-0.5">
                                    {uniqueVideoFilenames.map((filename, i) => (
                                      <li
                                        key={i}
                                        className="text-xs font-mono text-foreground/80"
                                      >
                                        {filename}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
