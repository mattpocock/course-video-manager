import { AddCourseModal } from "@/components/add-course-modal";
import { AddStandaloneVideoModal } from "@/components/add-standalone-video-modal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { openPlayground } from "@/lib/diagram-window";
import {
  Archive,
  CalendarDays,
  ChevronRight,
  FolderGit2,
  Lightbulb,
  Menu,
  PenTool,
  Plus,
  VideoIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
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
}

interface AppSidebarProps {
  variant: "rail" | "floating";
}

export function AppSidebar({ variant }: AppSidebarProps) {
  const data = useRouteLoaderData("routes/_app") as AppSidebarData | undefined;
  const topCourses = data?.topCourses ?? [];

  const location = useLocation();
  const navigate = useNavigate();

  const courseMatch = location.pathname.match(/^\/courses\/([^/]+)/);
  const selectedCourseId = courseMatch?.[1] ?? null;

  const archiveCourseFetcher = useFetcher();
  const createPitchFetcher = useFetcher<{ id: string }>();

  const [isAddCourseOpen, setIsAddCourseOpen] = useState(false);
  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setSheetOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (createPitchFetcher.state === "idle" && createPitchFetcher.data?.id) {
      navigate(`/pitches/${createPitchFetcher.data.id}`);
    }
  }, [createPitchFetcher.state, createPitchFetcher.data, navigate]);

  const onPitchesPath = location.pathname.startsWith("/pitches");
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
            onClick={() => setIsAddCourseOpen(true)}
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
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    archiveCourseFetcher.submit(
                      { archived: "true" },
                      {
                        method: "post",
                        action: `/api/courses/${course.id}/archive`,
                      }
                    );
                  }}
                >
                  <Archive className="w-4 h-4" />
                  Archive
                </ContextMenuItem>
              </ContextMenuContent>
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
      />

      <EntityCard
        icon={<VideoIcon className="w-4 h-4 text-muted-foreground" />}
        label="Videos"
        href="/videos"
        active={onVideosPath}
        onAdd={() => setIsAddVideoOpen(true)}
      />
    </div>
  );

  return (
    <>
      {variant === "rail" && (
        <div className="hidden md:flex w-80 border-r bg-muted/30 flex-col shrink-0">
          <div className="p-4 flex-1 flex flex-col min-h-0">{content}</div>
        </div>
      )}

      <div className={variant === "rail" ? "md:hidden" : undefined}>
        <Button
          className="fixed bottom-4 left-4 z-40 rounded-full shadow-lg size-12"
          size="icon"
          onClick={() => setSheetOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="left" className="p-0 flex flex-col">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="p-4 flex-1 flex flex-col min-h-0">{content}</div>
          </SheetContent>
        </Sheet>
      </div>

      <AddCourseModal
        isOpen={isAddCourseOpen}
        onOpenChange={setIsAddCourseOpen}
      />
      <AddStandaloneVideoModal
        open={isAddVideoOpen}
        onOpenChange={setIsAddVideoOpen}
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
