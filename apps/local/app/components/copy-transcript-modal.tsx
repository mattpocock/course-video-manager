import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Lesson, Section } from "@/features/course-view/course-view-types";
import {
  buildCourseTranscript,
  buildSectionTranscript,
  filterSectionsForTranscript,
  type TranscriptFilterOptions,
  type TranscriptFormat,
  type TranscriptOptions,
} from "@/features/course-view/section-transcript";
import { filterLessons } from "@/features/course-view/section-grid-utils";
import {
  ClipboardCopy,
  Code,
  ListChecks,
  MessageCircle,
  Play,
} from "lucide-react";
import { use, useMemo, useState } from "react";
import { toast } from "sonner";

type FilterProps = {
  priorityFilter: number[];
  iconFilter: string[];
  todoFilter: boolean;
  onTogglePriority: (priority: number) => void;
  onToggleIcon: (icon: string) => void;
  onToggleTodo: () => void;
};

type CourseMode = {
  mode: "course";
  courseName: string;
  sections: Section[];
};

type SectionMode = {
  mode: "section";
  sectionPath: string;
  sectionDescription?: string;
  lessons: Lesson[];
};

export function CopyTranscriptModal(
  props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    videoTranscripts: Promise<Record<string, string>>;
  } & FilterProps &
    (CourseMode | SectionMode)
) {
  const [format, setFormat] = useState<TranscriptFormat>("xml");
  const [options, setOptions] = useState<TranscriptOptions>({
    includeTranscripts: false,
    includeLessonDescriptions: true,
    includeLessonTitles: true,
    includePriority: false,
    includeExerciseType: false,
    includeSectionDescription: false,
    includeBeats: false,
  });

  const resolvedTranscripts = use(props.videoTranscripts);

  const preview = useMemo(() => {
    const filters: TranscriptFilterOptions = {
      priorityFilter: props.priorityFilter,
      iconFilter: props.iconFilter,
      todoFilter: props.todoFilter,
      searchQuery: "",
    };

    if (props.mode === "course") {
      const filteredSections = filterSectionsForTranscript(
        props.sections,
        filters
      );
      return buildCourseTranscript(
        props.courseName,
        filteredSections,
        options,
        resolvedTranscripts,
        format
      );
    }
    const { filteredLessons } = filterLessons(props.lessons, filters);
    return buildSectionTranscript(
      props.sectionPath,
      filteredLessons,
      options,
      resolvedTranscripts,
      props.sectionDescription,
      format
    );
  }, [props, options, resolvedTranscripts, format]);

  const byteCount = new TextEncoder().encode(preview).length;
  const approxTokens = Math.ceil(byteCount / 4);

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000) {
      return `~${(tokens / 1000).toFixed(1)}k tokens`;
    }
    return `~${tokens} tokens`;
  };

  const isCourse = props.mode === "course";
  const label = isCourse ? "Course" : "Section";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      toast(`${label} transcript copied to clipboard`);
      props.onOpenChange(false);
    } catch {
      toast.error("Failed to copy transcript to clipboard");
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy {label} Transcript</DialogTitle>
          <DialogDescription>
            Choose what to include in the exported transcript.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Filters */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Filters
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {([1, 2, 3] as const).map((priority) => {
                const isSelected = props.priorityFilter.includes(priority);
                const showAsActive =
                  props.priorityFilter.length === 0 || isSelected;
                return (
                  <button
                    key={priority}
                    className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors ${
                      showAsActive
                        ? priority === 1
                          ? "bg-red-500/20 text-red-600"
                          : priority === 2
                            ? "bg-yellow-500/20 text-yellow-600"
                            : "bg-sky-500/20 text-sky-500"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    } ${isSelected ? "ring-1 ring-current" : ""}`}
                    onClick={() => props.onTogglePriority(priority)}
                  >
                    P{priority}
                  </button>
                );
              })}

              <span className="text-muted-foreground mx-0.5">|</span>
              {(["code", "discussion", "watch"] as const).map((icon) => {
                const isSelected = props.iconFilter.includes(icon);
                const showAsActive =
                  props.iconFilter.length === 0 || isSelected;
                return (
                  <button
                    key={icon}
                    className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
                      icon === "code"
                        ? showAsActive
                          ? "bg-yellow-500/20 text-yellow-600"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                        : icon === "discussion"
                          ? showAsActive
                            ? "bg-green-500/20 text-green-600"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                          : showAsActive
                            ? "bg-purple-500/20 text-purple-600"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                    } ${isSelected ? "ring-1 ring-current" : ""}`}
                    onClick={() => props.onToggleIcon(icon)}
                    title={
                      icon === "code"
                        ? "Interactive"
                        : icon === "discussion"
                          ? "Discussion"
                          : "Watch"
                    }
                  >
                    {icon === "code" ? (
                      <Code className="w-3 h-3" />
                    ) : icon === "discussion" ? (
                      <MessageCircle className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                  </button>
                );
              })}

              <span className="text-muted-foreground mx-0.5">|</span>
              <button
                className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors flex items-center gap-1 ${
                  props.todoFilter
                    ? "bg-muted text-muted-foreground ring-1 ring-current"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                onClick={() => props.onToggleTodo()}
                title="Todo"
              >
                <ListChecks className="w-3 h-3" />
                Todo
              </button>
            </div>
          </div>

          {/* Format */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Format
            </span>
            <div className="flex items-center gap-2">
              {(["xml", "markdown", "json"] as const).map((fmt) => (
                <button
                  key={fmt}
                  className={`text-xs px-3 py-1 rounded-sm font-medium transition-colors ${
                    format === fmt
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  onClick={() => setFormat(fmt)}
                >
                  {fmt === "xml"
                    ? "XML"
                    : fmt === "markdown"
                      ? "Markdown"
                      : "JSON"}
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-section-description"
                checked={options.includeSectionDescription}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includeSectionDescription: checked === true,
                  }))
                }
              />
              <Label
                htmlFor="include-section-description"
                className="cursor-pointer"
              >
                Section description
              </Label>
              <span className="text-xs text-muted-foreground">
                Section-level description
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-lesson-titles"
                checked={options.includeLessonTitles}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includeLessonTitles: checked === true,
                  }))
                }
              />
              <Label htmlFor="include-lesson-titles" className="cursor-pointer">
                Lesson titles
              </Label>
              <span className="text-xs text-muted-foreground">
                Human-readable lesson names
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-lesson-descriptions"
                checked={options.includeLessonDescriptions}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includeLessonDescriptions: checked === true,
                  }))
                }
              />
              <Label
                htmlFor="include-lesson-descriptions"
                className="cursor-pointer"
              >
                Lesson descriptions
              </Label>
              <span className="text-xs text-muted-foreground">
                Description metadata
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-transcripts"
                checked={options.includeTranscripts}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includeTranscripts: checked === true,
                  }))
                }
              />
              <Label htmlFor="include-transcripts" className="cursor-pointer">
                Transcripts
              </Label>
              <span className="text-xs text-muted-foreground">
                Clip text content
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-beats"
                checked={options.includeBeats}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includeBeats: checked === true,
                  }))
                }
              />
              <Label htmlFor="include-beats" className="cursor-pointer">
                Beats
              </Label>
              <span className="text-xs text-muted-foreground">
                Video planning beats (kind, title, description)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-priority"
                checked={options.includePriority}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includePriority: checked === true,
                  }))
                }
              />
              <Label htmlFor="include-priority" className="cursor-pointer">
                Priority
              </Label>
              <span className="text-xs text-muted-foreground">
                P1, P2, P3 labels
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="include-exercise-type"
                checked={options.includeExerciseType}
                onCheckedChange={(checked) =>
                  setOptions((o) => ({
                    ...o,
                    includeExerciseType: checked === true,
                  }))
                }
              />
              <Label htmlFor="include-exercise-type" className="cursor-pointer">
                Exercise type
              </Label>
              <span className="text-xs text-muted-foreground">
                Watch, code, or discussion
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Estimated size</span>
            <span className="font-medium">{formatTokens(approxTokens)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCopy}>
            <ClipboardCopy className="w-4 h-4 mr-1" />
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
