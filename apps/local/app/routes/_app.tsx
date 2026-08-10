import { AppSidebar } from "@/components/app-sidebar";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { Outlet, useMatches } from "react-router";

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const courseOps = yield* CourseOperationsService;
      const topCourses = yield* courseOps.getTopActiveCourses(3);
      return {
        topCourses: topCourses.map((c) => ({ id: c.id, name: c.name })),
      };
    }),
});

export default function AppLayout() {
  const matches = useMatches();
  const isFullscreen = matches.some(
    (m) => (m.handle as { fullscreen?: boolean } | undefined)?.fullscreen
  );

  return (
    <div className="flex min-h-screen">
      <AppSidebar variant={isFullscreen ? "floating" : "rail"} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Outlet />
      </div>
    </div>
  );
}
