import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2, AlertTriangle, File } from "lucide-react";

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function DeleteLessonModal(props: {
  lessonId: string;
  lessonTitle: string;
  filesOnDisk: { path: string; size: number }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const hasFiles = props.filesOnDisk.length > 0;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            Delete Lesson
          </DialogTitle>
          <DialogDescription>
            Permanently delete "{props.lessonTitle}" and all its files from
            disk.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {hasFiles && (
            <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 rounded-md p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <span>These files will be permanently deleted:</span>
                <div className="rounded border border-amber-200 dark:border-amber-800 bg-white/50 dark:bg-black/20 p-2 max-h-60 overflow-y-auto">
                  <ul className="space-y-1">
                    {props.filesOnDisk
                      .sort((a, b) => a.path.localeCompare(b.path))
                      .map((entry) => (
                        <li
                          key={entry.path}
                          className="flex items-center gap-1.5 text-xs font-mono"
                        >
                          <File className="w-3 h-3 shrink-0 opacity-60" />
                          <span className="truncate">{entry.path}</span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                            {formatFileSize(entry.size)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                props.onDelete();
                props.onOpenChange(false);
              }}
            >
              Delete Lesson
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
