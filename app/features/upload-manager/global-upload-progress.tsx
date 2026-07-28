import { useContext, useEffect, useCallback } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { UploadContext } from "./upload-context";
import { UploadRow } from "./upload-row";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";

const CIRCLE_RADIUS = 16;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

export function GlobalUploadProgress() {
  const { uploads, dismissUpload } = useContext(UploadContext);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const uploadEntries = Object.values(uploads);
  const hasUploads = uploadEntries.length > 0;

  const activeUploads = uploadEntries.filter(
    (u) =>
      u.status === "uploading" ||
      u.status === "retrying" ||
      u.status === "waiting"
  );
  const isActive = activeUploads.length > 0;

  const completedCount = uploadEntries.filter(
    (u) => u.status === "success"
  ).length;
  const errorCount = uploadEntries.filter((u) => u.status === "error").length;

  const aggregateProgress =
    activeUploads.length > 0
      ? Math.round(
          activeUploads.reduce((sum, u) => sum + u.progress, 0) /
            activeUploads.length
        )
      : 100;

  const strokeDashoffset =
    CIRCLE_CIRCUMFERENCE - (aggregateProgress / 100) * CIRCLE_CIRCUMFERENCE;

  // Auto-dismiss all uploads 5 seconds after all finish
  useEffect(() => {
    if (!hasUploads || isActive) return;

    const timer = setTimeout(() => {
      for (const upload of uploadEntries) {
        dismissUpload(upload.uploadId);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [hasUploads, isActive, uploadEntries, dismissUpload]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent, uploadId: string) => {
      e.stopPropagation();
      dismissUpload(uploadId);
    },
    [dismissUpload]
  );

  if (!hasUploads) return null;

  return (
    <>
      {/* Floating circular indicator */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-16 right-4 z-40 flex items-center justify-center size-10 rounded-full shadow-lg bg-background border hover:bg-accent transition-colors"
        aria-label="View upload status"
        type="button"
      >
        <svg
          className="absolute inset-0 -rotate-90"
          viewBox="0 0 40 40"
          fill="none"
        >
          {/* Background circle */}
          <circle
            cx="20"
            cy="20"
            r={CIRCLE_RADIUS}
            stroke="currentColor"
            strokeWidth="3"
            className="text-secondary"
          />
          {/* Progress circle */}
          <circle
            cx="20"
            cy="20"
            r={CIRCLE_RADIUS}
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCLE_CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            className={`transition-all duration-300 ${
              errorCount > 0
                ? "text-destructive"
                : isActive
                  ? "text-primary"
                  : "text-green-500"
            }`}
          />
        </svg>
        {/* Center icon */}
        <span className="relative z-10">
          {isActive ? (
            <Loader2 className="size-4 text-primary animate-spin" />
          ) : errorCount > 0 ? (
            <AlertCircle className="size-4 text-destructive" />
          ) : (
            <CheckCircle2 className="size-4 text-green-500" />
          )}
        </span>
      </button>

      {/* Upload details modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Uploads
              {isActive && (
                <Badge variant="secondary" className="text-xs">
                  {activeUploads.length} active
                </Badge>
              )}
              {completedCount > 0 && (
                <Badge variant="secondary" className="text-xs text-green-500">
                  {completedCount} done
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge variant="secondary" className="text-xs text-destructive">
                  {errorCount} failed
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto -mx-6 px-6">
            {uploadEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No uploads
              </p>
            ) : (
              <div className="space-y-0 divide-y">
                {uploadEntries.map((upload) => (
                  <UploadRow
                    key={upload.uploadId}
                    upload={upload}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
