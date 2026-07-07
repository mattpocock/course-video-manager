import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

export function MoveVideoModal(props: {
  videoId: string;
  videoTitle: string;
  currentLessonId: string;
  sections: {
    path: string;
    lessons: { id: string; path: string }[];
  }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAfterMove?: (targetLessonId: string) => void;
}) {
  const fetcher = useFetcher();
  const [selectedLessonId, setSelectedLessonId] = useState<string>("");

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedLessonId("");
    }
    props.onOpenChange(open);
  };

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5" />
            Move Video
          </DialogTitle>
          <DialogDescription>
            Move "{props.videoTitle}" to a different lesson.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Select value={selectedLessonId} onValueChange={setSelectedLessonId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a lesson..." />
            </SelectTrigger>
            <SelectContent>
              {props.sections.map((section) => {
                const availableLessons = section.lessons.filter(
                  (lesson) => lesson.id !== props.currentLessonId
                );
                if (availableLessons.length === 0) return null;
                return (
                  <SelectGroup key={section.path}>
                    <SelectLabel>{section.path}</SelectLabel>
                    {availableLessons.map((lesson) => (
                      <SelectItem key={lesson.id} value={lesson.id}>
                        {lesson.path}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button
              disabled={!selectedLessonId || fetcher.state === "submitting"}
              onClick={async () => {
                await fetcher.submit(
                  { lessonId: selectedLessonId },
                  {
                    method: "post",
                    action: `/api/videos/${props.videoId}/move-to-lesson`,
                  }
                );
                props.onAfterMove?.(selectedLessonId);
                handleOpenChange(false);
              }}
            >
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Move"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
