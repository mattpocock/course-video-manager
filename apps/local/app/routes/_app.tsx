import { AppSidebar } from "@/components/app-sidebar";
import { RemountCommand } from "@/components/remount-command";
import { GlobalUploadProgress } from "@/features/upload-manager/global-upload-progress";
import { UploadProvider } from "@/features/upload-manager/upload-context";
import { LiveStreamProvider } from "@/features/streaming/live-stream-context";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import { onlyRootFilterChanged } from "@/features/storage/root-filter";
import { offlineStorageRoots } from "@/services/storage-root-availability.server";
import { getFootageStats } from "@cvm/core/services/db-footage-stats.server";
import { Effect } from "effect";
import {
  Outlet,
  useLoaderData,
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
      const [topCourses, footageStats, offlineRoots] = yield* Effect.all(
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
          // Cached and cheap: an unplugged drive shows as one banner on
          // every page, not as a page that fails.
          offlineStorageRoots,
        ],
        { concurrency: "unbounded" }
      );
      return {
        topCourses: topCourses.map((c) => ({ id: c.id, name: c.name })),
        footageStats,
        offlineRoots,
      };
    }),
});

/**
 * Also reload on every move to a new page, not only after a form submit, so
 * the sidebar's footage stats pick up a take recorded on the page just left.
 * It runs alongside the new page's own loader. Toggling the Storage Root
 * filter (#2431) only filters what the page already has: no reload.
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) =>
  formMethod === undefined && onlyRootFilterChanged(currentUrl, nextUrl)
    ? false
    : defaultShouldRevalidate || currentUrl.pathname !== nextUrl.pathname;

/**
 * One line per Offline Storage Root, naming the drive and what to do, with
 * the command that remounts it ready to copy.
 */
function OfflineStorageRootsBanner() {
  const { offlineRoots } = useLoaderData<typeof loader>();
  if (offlineRoots.length === 0) return null;
  return (
    <div
      role="alert"
      className="border-b border-amber-500/40 bg-amber-500/20 px-4 py-2 text-sm text-amber-600"
    >
      {offlineRoots.map(({ root, message, remountCommand }) => (
        <div key={root} className="space-y-1 py-0.5">
          <p>{message}</p>
          {remountCommand !== null && (
            <RemountCommand command={remountCommand} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function AppLayout() {
  const matches = useMatches();
  const isFullscreen = matches.some(
    (m) => (m.handle as { fullscreen?: boolean } | undefined)?.fullscreen
  );

  // The Job stream (`/api/jobs/events`) opens here, not in the root: the
  // teleprompter and Diagram Playground windows show no uploads, and each
  // long-lived stream holds one of the browser's six connections to the
  // app, which every CVM window shares.
  //
  // The Live Stream surface lives here too, so the picked Broadcast (and the
  // Live Stream) outlive the Streaming tab.
  return (
    <UploadProvider>
      <LiveStreamProvider>
        <GlobalUploadProgress />
        <div className="flex min-h-screen">
          <AppSidebar variant={isFullscreen ? "floating" : "rail"} />
          <div className="flex-1 min-w-0 flex flex-col">
            <OfflineStorageRootsBanner />
            <Outlet />
          </div>
        </div>
      </LiveStreamProvider>
    </UploadProvider>
  );
}
