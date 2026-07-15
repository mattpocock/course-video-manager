import { useContext, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Upload,
  X,
  ExternalLink,
  Cloud,
  Send,
  Film,
  Clock,
  Loader2,
  FolderSync,
} from "lucide-react";
import { Link } from "react-router";
import { UploadContext } from "./upload-context";
import type { uploadReducer } from "./upload-reducer";
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

function UploadRow({
  upload,
  onDismiss,
}: {
  upload: uploadReducer.UploadEntry;
  onDismiss: (e: React.MouseEvent, uploadId: string) => void;
}) {
  return (
    <div className="py-2.5 flex items-center gap-3">
      <StatusIcon upload={upload} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{upload.title}</p>
        <UploadStatusDetail upload={upload} />
      </div>
      {!(upload.uploadType === "export" && upload.isBatchEntry) && (
        <button
          onClick={(e) => onDismiss(e, upload.uploadId)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          type="button"
          aria-label="Dismiss upload"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusIcon({ upload }: { upload: uploadReducer.UploadEntry }) {
  switch (upload.status) {
    case "waiting":
      return <Clock className="size-4 text-muted-foreground shrink-0" />;
    case "uploading":
      if (upload.uploadType === "buffer") {
        switch (upload.bufferStage) {
          case "creating-post":
          case "polling":
            return <Send className="size-4 text-blue-500 shrink-0" />;
          case "cleaning-up":
            return <Cloud className="size-4 text-blue-500 shrink-0" />;
          default:
            return <Upload className="size-4 text-blue-500 shrink-0" />;
        }
      }
      if (upload.uploadType === "export") {
        return <Film className="size-4 text-blue-500 shrink-0" />;
      }
      if (upload.uploadType === "dropbox-publish") {
        return <FolderSync className="size-4 text-blue-500 shrink-0" />;
      }
      if (upload.uploadType === "publish") {
        return <Send className="size-4 text-blue-500 shrink-0" />;
      }
      return <Upload className="size-4 text-blue-500 shrink-0" />;
    case "retrying":
      return (
        <RefreshCw className="size-4 text-yellow-500 shrink-0 animate-spin" />
      );
    case "success":
      return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
    case "error":
      return <AlertCircle className="size-4 text-destructive shrink-0" />;
  }
}

const BUFFER_STAGE_LABELS: Record<uploadReducer.BufferStage, string> = {
  "uploading-blob": "Uploading to cloud",
  "creating-post": "Creating Buffer post",
  polling: "Waiting for delivery",
  "cleaning-up": "Cleaning up",
};

const EXPORT_STAGE_LABELS: Record<uploadReducer.ExportStage, string> = {
  queued: "Queued",
  "concatenating-clips": "Concatenating clips",
  "normalizing-audio": "Normalizing audio",
};

const PUBLISH_STAGE_LABELS: Record<uploadReducer.PublishStage, string> = {
  validating: "Validating",
  exporting: "Exporting videos",
  uploading: "Uploading to Dropbox",
  freezing: "Freezing version",
  cloning: "Creating new draft",
};

function UploadStatusDetail({ upload }: { upload: uploadReducer.UploadEntry }) {
  switch (upload.status) {
    case "waiting":
      return (
        <p className="text-xs text-muted-foreground mt-0.5">
          Waiting for export...
        </p>
      );
    case "uploading":
      if (upload.uploadType === "buffer" && upload.bufferStage) {
        const stageLabel = BUFFER_STAGE_LABELS[upload.bufferStage];
        if (upload.bufferStage === "uploading-blob") {
          return (
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">
                {upload.progress}%
              </span>
            </div>
          );
        }
        return (
          <p className="text-xs text-muted-foreground mt-0.5">
            {stageLabel}...
          </p>
        );
      }
      if (upload.uploadType === "export" && upload.exportStage) {
        const stageLabel = EXPORT_STAGE_LABELS[upload.exportStage];
        return (
          <p className="text-xs text-muted-foreground mt-0.5">
            {stageLabel}...
          </p>
        );
      }
      if (upload.uploadType === "publish" && upload.publishStage) {
        const stageLabel = PUBLISH_STAGE_LABELS[upload.publishStage];
        return (
          <p className="text-xs text-muted-foreground mt-0.5">
            {stageLabel}...
          </p>
        );
      }
      if (upload.uploadType === "dropbox-publish") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${upload.progress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-8 text-right">
              {upload.progress}%
            </span>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground w-8 text-right">
            {upload.progress}%
          </span>
        </div>
      );
    case "retrying":
      return (
        <p className="text-xs text-yellow-500 mt-0.5">
          Retrying... (attempt {upload.retryCount + 1})
        </p>
      );
    case "success":
      if (upload.uploadType === "buffer") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Sent to Buffer
            </Badge>
          </div>
        );
      }
      if (upload.uploadType === "youtube") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Complete
            </Badge>
            {upload.youtubeVideoId && (
              <a
                href={`https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                YouTube Studio
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        );
      }
      if (upload.uploadType === "ai-hero") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Posted to AI Hero
            </Badge>
            {upload.aiHeroSlug && (
              <a
                href={`https://aihero.dev/${upload.aiHeroSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                View Post
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        );
      }
      if (upload.uploadType === "export") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Exported
            </Badge>
          </div>
        );
      }
      if (upload.uploadType === "publish") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Published
            </Badge>
          </div>
        );
      }
      if (upload.uploadType === "dropbox-publish") {
        const missingCount = upload.missingVideoCount ?? 0;
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 ${missingCount > 0 ? "text-yellow-500" : "text-green-500"}`}
            >
              {missingCount > 0
                ? `Published (${missingCount} missing)`
                : "Published to Dropbox"}
            </Badge>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <Badge
            variant="secondary"
            className="text-green-500 text-[10px] px-1.5 py-0"
          >
            Complete
          </Badge>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-destructive truncate">
            {upload.errorMessage}
          </span>
          {upload.uploadType !== "dropbox-publish" &&
            upload.uploadType !== "publish" && (
              <Link
                to={`/videos/${upload.videoId}/post`}
                className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                Go to Post
              </Link>
            )}
        </div>
      );
  }
}
