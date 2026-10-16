import { AppSidebar } from "@/components/app-sidebar";
import { GlobalUploadProgress } from "@/features/upload-manager/global-upload-progress";
import { UploadProvider } from "@/features/upload-manager/upload-context";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import { getFootageStats } from "@cvm/core/services/db-footage-stats.server";
import { Effect } from "effect";
import {
  Outlet,
  useMatches,
  type ShouldRevalidateFunction,
} from "react-router";

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const db = yield* DrizzleService;
      const courseOps = yield* CourseOperationsService;
      // The two reads run side by side, so the stats add only what they take
      // beyond the Courses query (a few ms; see db-footage-stats.server.ts).
      const [topCourses, footageStats] = yield* Effect.all(
        [
          courseOps.getTopActiveCourses(3),
          // Days start at midnight where the app runs: the author's machine.
          getFootageStats(db, {
            now: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).pipe(
            // A sidebar extra must not take every page down with it.
            Effect.catchTag("UnknownDBServiceError", (error) =>
              Effect.logWarning("Footage stats failed", error.cause).pipe(
                Effect.as(null)
              )
            )
          ),
        ],
        { concurrency: "unbounded" }
      );
      return {
        topCourses: topCourses.map((c) => ({ id: c.id, name: c.name })),
        footageStats,
      };
    }),
});

/**
 * Also reload on every move to a new page, not only after a form submit, so
 * the sidebar's footage stats pick up a take recorded on the page just left.
 * It runs alongside the new page's own loader.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => defaultShouldRevalidate || currentUrl.pathname !== nextUrl.pathname;

export default function AppLayout() {
  const matches = useMatches();
  const isFullscreen = matches.some(
    (m) => (m.handle as { fullscreen?: boolean } | undefined)?.fullscreen
  );

  // The Job stream (`/api/jobs/events`) opens here, not in the root: the
  // teleprompter and Diagram Playground windows show no uploads, and each
  // long-lived stream holds one of the browser's six connections to the
  // app, which every CVM window shares.
  return (
    <UploadProvider>
      <GlobalUploadProgress />
      <div className="flex min-h-screen">
        <AppSidebar variant={isFullscreen ? "floating" : "rail"} />
        <div className="flex-1 min-w-0 flex flex-col">
          <Outlet />
        </div>
      </div>
    </UploadProvider>
  );
}
