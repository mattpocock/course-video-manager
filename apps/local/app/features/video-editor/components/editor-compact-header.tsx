import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  VideoIcon,
  SendIcon,
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
