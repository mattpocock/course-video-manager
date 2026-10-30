import { AddCourseModal } from "@/components/add-course-modal";
import { AddStandaloneVideoModal } from "@/components/add-standalone-video-modal";
import { FootageStats } from "@/components/footage-stats";
import type { FootageStats as FootageStatsData } from "@cvm/core/services/db-footage-stats.server";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CourseMenuContent,
  type CourseMenuAction,
  type CourseMenuIntent,
} from "@/features/course-view/course-menu";
import { cn } from "@/lib/utils";
import { openPlayground } from "@/lib/diagram-window";
import {
  Archive,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  FolderGit2,
  HardDrive,
  KeyRound,
  Lightbulb,
  Menu,
  Mic,
  MonitorSmartphone,
  PenTool,
  Plus,
  RadioIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import type { appSidebarReducer } from "./app-sidebar-reducer";
import { useAppSidebarReducer } from "./use-app-sidebar-reducer";
import { NEW_SHORT_ACTION, newShortFormData } from "@/lib/new-short";
import {
  NEW_STREAM_VIDEO_ACTION,
  newStreamVideoFormData,
} from "@/features/streaming/new-stream-video";

type AppSidebarModal = appSidebarReducer.Modal;
import {
  Link,
  useFetcher,
  useLocation,
  useNavigate,
  useRouteLoaderData,
} from "react-router";

export interface SidebarCourse {
  id: string;
  name: string;
}

export interface AppSidebarData {
  topCourses: SidebarCourse[];
  footageStats: FootageStatsData | null;
}

interface AppSidebarProps {
  variant: "rail" | "floating";
}

export function AppSidebar({ variant }: AppSidebarProps) {
  const data = useRouteLoaderData("routes/_app") as AppSidebarData | undefined;
  const topCourses = data?.topCourses ?? [];
  const footageStats = data?.footageStats;

  const location = useLocation();

  const courseMatch = location.pathname.match(/^\/courses\/([^/]+)/);
  const selectedCourseId = courseMatch?.[1] ?? null;

  const archiveCourseFetcher = useFetcher();
  const navigate = useNavigate();

  // The same Course menu as the course page's Actions button. Actions that
  // need the page's dialogs or selected Version go there and run on arrival.
  const runCourseAction = (courseId: string, action: CourseMenuAction) => {
    switch (action) {
      case "rename":
      case "duplicate":
      case "export":
      case "copy-transcript":
      case "purge-exports": {
        const state: CourseMenuIntent = { courseMenuAction: action };
        return void navigate(`/courses/${courseId}`, { state });
      }
      case "preview-changelog":
        return void navigate(`/courses/${courseId}/changelog`);
      case "view-archived-lessons":
        return void navigate(`/courses/${courseId}/archived-lessons`);
      case "publish":
        return void navigate(`/courses/${courseId}/publish`);
      case "archive":
      case "unarchive":
        return void archiveCourseFetcher.submit(
          { archived: action === "archive" ? "true" : "false" },
          { method: "post", action: `/api/courses/${courseId}/archive` }
        );
    }
  };
  const createPitchFetcher = useFetcher();
  const createShortFetcher = useFetcher();
  const createStreamVideoFetcher = useFetcher();

  const { state, dispatch } = useAppSidebarReducer();

  // Bridge: navigating anywhere closes the mobile sheet.
  useEffect(() => {
    dispatch({ type: "location-changed" });
  }, [location.pathname, location.search, dispatch]);

  // Stable per dialog, so a dialog may list its onOpenChange as an effect
  // dependency.
  const dismiss = useMemo(() => {
    const onOpenChange = (modal: AppSidebarModal) => (open: boolean) => {
      if (!open) dispatch({ type: "modal-dismissed", modal });
    };
    return {
      "add-course": onOpenChange("add-course"),
      "add-video": onOpenChange("add-video"),
    };
  }, [dispatch]);

  const onPitchesPath = location.pathname.startsWith("/pitches");
  const onShortsPath = location.pathname.startsWith("/shorts");
  const onVideosPath =
    location.pathname === "/videos" ||
    location.pathname === "/videos/concatenate";
  const onDeliverablesPath =
    location.pathname === "/" || location.pathname.startsWith("/deliverables");

  const content = (
    <div className="space-y-3 flex-1 overflow-y-auto">
      <EntityCard
        icon={<CalendarDays className="w-4 h-4 text-muted-foreground" />}
        label="Deliverables"
        href="/"
        active={onDeliverablesPath}
      />

      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Courses</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => dispatch({ type: "add-course-clicked" })}
            aria-label="Add course"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="space-y-0.5">
          {topCourses.map((course) => (
            <ContextMenu key={course.id}>
              <ContextMenuTrigger asChild>
                <Link
                  to={`/courses/${course.id}`}
                  preventScrollReset
                  className={cn(
                    "block w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-accent transition-colors truncate",
                    selectedCourseId === course.id &&
                      "bg-muted text-foreground/90"
                  )}
                >
                  {course.name}
                </Link>
              </ContextMenuTrigger>
              <CourseMenuContent
                menu="context"
                course={{
                  id: course.id,
                  archived: false,
                  isLatestVersion: true,
                }}
                run={(action) => runCourseAction(course.id, action)}
              />
            </ContextMenu>
          ))}
        </div>
        <Link
          to="/archived-courses"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 px-2 transition-colors"
        >
          <Archive className="w-3 h-3" />
          Archived Courses
        </Link>
      </div>

      <EntityCard
        icon={<Lightbulb className="w-4 h-4 text-muted-foreground" />}
        label="Pitches"
        href="/pitches"
        active={onPitchesPath}
        onAdd={() => {
          createPitchFetcher.submit(
            {},
            { method: "post", action: "/api/pitches/create" }
          );
        }}
        addDisabled={createPitchFetcher.state !== "idle"}
      />

      <EntityCard
        icon={<PenTool className="w-4 h-4 text-muted-foreground" />}
        label="Diagrams"
        onClick={() => openPlayground()}
        onAdd={() => dispatch({ type: "create-diagram-clicked" })}
        addDisabled={state.creatingDiagram}
      />

      <EntityCard
        icon={<Clapperboard className="w-4 h-4 text-muted-foreground" />}
        label="Shorts"
        href="/shorts"
        active={onShortsPath}
        onAdd={() => {
          createShortFetcher.submit(newShortFormData(), {
            method: "post",
            action: NEW_SHORT_ACTION,
          });
        }}
        addDisabled={createShortFetcher.state !== "idle"}
      />

      <EntityCard
        icon={<RadioIcon className="w-4 h-4 text-muted-foreground" />}
        label="Streaming"
        href="/streaming"
        active={location.pathname.startsWith("/streaming")}
        onAdd={() => {
          void createStreamVideoFetcher.submit(newStreamVideoFormData(), {
            method: "post",
            action: NEW_STREAM_VIDEO_ACTION,
          });
        }}
        addDisabled={createStreamVideoFetcher.state !== "idle"}
      />

      <EntityCard
        icon={<VideoIcon className="w-4 h-4 text-muted-foreground" />}
        label="Videos"
        href="/videos"
        active={onVideosPath}
        onAdd={() => dispatch({ type: "add-video-clicked" })}
      />

      <EntityCard
        icon={<MonitorSmartphone className="w-4 h-4 text-muted-foreground" />}
        label="Space Desk"
        onClick={() => dispatch({ type: "spacedesk-clicked" })}
      />

      <EntityCard
        icon={<Mic className="w-4 h-4 text-muted-foreground" />}
        label="AV Calibration"
        href="/av-calibration"
        active={location.pathname.startsWith("/av-calibration")}
      />

      <EntityCard
        icon={<HardDrive className="w-4 h-4 text-muted-foreground" />}
        label="Storage"
        href="/storage"
        active={location.pathname.startsWith("/storage")}
      />

      <EntityCard
        icon={<KeyRound className="w-4 h-4 text-muted-foreground" />}
        label="API Tokens"
        href="/api-tokens"
        active={location.pathname.startsWith("/api-tokens")}
      />
    </div>
  );

  // Pinned below the nav list, which scrolls on its own.
  const footer = data && <FootageStats stats={footageStats ?? null} />;

  return (
    <>
      {/*
        The page scrolls at the document level, so the rail sticks to the
        viewport to stay visible. A sticky box can only travel inside its own
        containing block, and the layout's default `align-items: stretch` would
        size the rail to the full scrollable page — leaving it nowhere to
        travel. `self-start` + `h-screen` cap it at the viewport instead, which
        also gives the nav list below a real scrollport when it overflows.
      */}
      {variant === "rail" && (
        <div className="hidden md:flex w-80 border-r bg-muted/30 flex-col shrink-0 sticky top-0 self-start h-screen">
          <div className="p-4 flex-1 flex flex-col min-h-0">
            {content}
            {footer}
          </div>
        </div>
      )}

      <div className={variant === "rail" ? "md:hidden" : undefined}>
        <Button
          className="fixed bottom-4 left-4 z-40 rounded-full shadow-lg size-12"
          size="icon"
          onClick={() => dispatch({ type: "menu-button-clicked" })}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>

        <Sheet
          open={state.sheetOpen}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "sheet-dismissed" });
          }}
        >
          <SheetContent side="left" className="p-0 flex flex-col">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="p-4 flex-1 flex flex-col min-h-0">
              {content}
              {footer}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <AddCourseModal
        isOpen={state.openModal === "add-course"}
        onOpenChange={dismiss["add-course"]}
      />
      <AddStandaloneVideoModal
        open={state.openModal === "add-video"}
        onOpenChange={dismiss["add-video"]}
      />
    </>
  );
}

interface EntityCardProps {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  onAdd?: () => void;
  addDisabled?: boolean;
}

function EntityCard({
  icon,
  label,
  href,
  onClick,
  active,
  onAdd,
  addDisabled,
}: EntityCardProps) {
  const inner = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-sm font-medium truncate">{label}</span>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
    </>
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card flex items-center pr-2 transition-colors",
        active && "border-foreground/20 bg-muted"
      )}
    >
      {href ? (
        <Link
          to={href}
          className="flex items-center justify-between gap-2 flex-1 min-w-0 px-3 py-2.5 hover:bg-accent/40 rounded-l-lg transition-colors"
        >
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="flex items-center justify-between gap-2 flex-1 min-w-0 px-3 py-2.5 hover:bg-accent/40 rounded-l-lg transition-colors text-left"
        >
          {inner}
        </button>
      )}
      {onAdd && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onAdd}
          disabled={addDisabled}
          aria-label={`Add ${label.toLowerCase()}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
