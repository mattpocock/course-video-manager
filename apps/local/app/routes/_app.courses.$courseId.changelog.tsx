import { Button } from "@/components/ui/button";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { generateChangelog } from "@/services/changelog-service";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArrowLeft } from "lucide-react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { Link } from "react-router";
import type { Route } from "./+types/_app.courses.$courseId.changelog";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const versionOps = yield* VersionOperationsService;

      const [repo, versions] = yield* Effect.all(
        [
          courseOps.getCourseById(params.courseId!),
          versionOps.getAllVersionsWithStructure(params.courseId!),
        ],
        { concurrency: "unbounded" }
      );
      const changelog = generateChangelog(versions);

      return {
        repo,
        changelog,
      };
    }),
});

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
