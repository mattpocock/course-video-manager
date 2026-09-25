import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  VideoIcon,
  SendIcon,
  PlayIcon,
} from "lucide-react";
import { Link } from "react-router";

export const EditorCompactHeader = (props: {
  backButtonUrl: string;
  breadcrumb: string;
  nextVideoId: string | null;
  previousVideoId: string | null;
  showTabSwitcher: boolean;
  videoId: string;
  lessonId: string | null;
  /** True iff this Video has ≥1 Clip Mockup, so there is an Animatic to watch. */
  hasAnimatic: boolean;
}) => {
  const tabs = [
    { id: "edit", label: "Video", path: "edit", icon: VideoIcon },
    {
      id: "post",
      label: "Post",
      path: props.lessonId ? "lesson" : "post",
      icon: SendIcon,
    },
  ];

  return (
    <div className="flex items-center gap-2 px-1 shrink-0">
      <Button variant="ghost" size="icon" className="size-8" asChild>
        <Link to={props.backButtonUrl}>
          <ChevronLeftIcon className="size-5" />
        </Link>
      </Button>

      <span className="text-sm text-muted-foreground truncate min-w-0">
        {props.breadcrumb}
      </span>

      <div className="flex-1" />

      {/* Into the Animatic, beside the tab switcher. This is the ONLY way
          into the Animatic from the editor, so without it an author cannot
          see that an Animatic exists at all. A `Link`, in this tab, like
          every other tab of the Video: the Animatic is a page of the Video,
          and a second tab left the author with two editors open. */}
      {props.hasAnimatic && (
        <Link
          to={`/videos/${props.videoId}/animatic`}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <PlayIcon className="size-3.5" />
          Animatic
        </Link>
      )}

      {props.showTabSwitcher && (
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              to={`/videos/${props.videoId}/${tab.path}`}
              className={cn(
                "px-2 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1",
                tab.id === "edit"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        {props.previousVideoId && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
            <Link to={`/videos/${props.previousVideoId}/edit`}>
              <ChevronLeftIcon className="size-3.5 mr-0.5" />
              Prev
            </Link>
          </Button>
        )}
        {props.nextVideoId && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
            <Link to={`/videos/${props.nextVideoId}/edit`}>
              Next
              <ChevronRightIcon className="size-3.5 ml-0.5" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
};
