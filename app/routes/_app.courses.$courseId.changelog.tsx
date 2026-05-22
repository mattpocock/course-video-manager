import { Button } from "@/components/ui/button";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { generateChangelog } from "@/services/changelog-service";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { runtimeLive } from "@/services/layer.server";
import { Console, Effect } from "effect";
import { ArrowLeft } from "lucide-react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { data, Link } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.changelog";

export const loader = async (args: Route.LoaderArgs) => {
  const { courseId: repoId } = args.params;

  return Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    const versionOps = yield* VersionOperationsService;

    const [repo, versions] = yield* Effect.all(
      [
        courseOps.getCourseById(repoId),
        versionOps.getAllVersionsWithStructure(repoId),
      ],
      { concurrency: "unbounded" }
    );
    const changelog = generateChangelog(versions);

    return {
      repo,
      changelog,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Repo not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const { repo, changelog } = props.loaderData;

  useFocusRevalidate({ enabled: true });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6">
          <Link to={`/courses/${repo.id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {repo.name}
            </Button>
          </Link>
        </div>

        <div className="prose dark:prose-invert max-w-none">
          <Markdown rehypePlugins={[rehypeRaw]}>{changelog}</Markdown>
        </div>
      </div>
    </div>
  );
}
