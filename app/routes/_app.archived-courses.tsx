import { Button } from "@/components/ui/button";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { ArchiveRestore } from "lucide-react";
import { useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/_app.archived-courses";

export const meta: Route.MetaFunction = () => {
  return [
    {
      title: "CVM - Archived Courses",
    },
  ];
};

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const archivedCourses = yield* courseOps.getArchivedCourses();
      return { archivedCourses };
    }),
});

export default function ArchivedCourses(props: Route.ComponentProps) {
  const unarchiveCourseFetcher = useFetcher();
  const data = props.loaderData;
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Archived Courses</h1>

        {data.archivedCourses.length === 0 ? (
          <p className="text-muted-foreground">No archived courses.</p>
        ) : (
          <div className="space-y-2">
            {data.archivedCourses.map((course) => (
              <div
                key={course.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div>
                  <Button
                    variant="link"
                    className="h-auto p-0 font-medium text-base"
                    onClick={() => {
                      navigate(`/courses/${course.id}`, {
                        preventScrollReset: true,
                      });
                    }}
                  >
                    {course.name}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    unarchiveCourseFetcher.submit(
                      { archived: "false" },
                      {
                        method: "post",
                        action: `/api/courses/${course.id}/archive`,
                      }
                    );
                  }}
                  disabled={unarchiveCourseFetcher.state !== "idle"}
                >
                  <ArchiveRestore className="w-4 h-4 mr-2" />
                  Unarchive
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
