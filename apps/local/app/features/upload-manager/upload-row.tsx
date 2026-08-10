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
} from "lucide-react";
import { Link } from "react-router";
import type { uploadReducer } from "./upload-reducer";
import { uploadStageLabel } from "./upload-stage-labels";
import { Badge } from "@/components/ui/badge";

export function UploadRow({
  upload,
  onDismiss,
  nested = false,
}: {
  upload: uploadReducer.UploadEntry;
  onDismiss: (e: React.MouseEvent, uploadId: string) => void;
  /** A child task, indented under the parent job that spawned it. */
  nested?: boolean;
}) {
  return (
    <div
      className={`py-2.5 flex items-center gap-3 ${
        nested ? "pl-5 border-l-2 border-muted ml-1.5" : ""
      }`}
    >
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
        return upload.videoUploadStage ? (
          <Cloud className="size-4 text-blue-500 shrink-0" />
        ) : (
          <Film className="size-4 text-blue-500 shrink-0" />
        );
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

/**
 * The inline per-job progress bar. Every unfinished job gets one, so the modal
 * reads as one column of bars rather than a mix of bars and prose: `label`
 * names the stage (when the job type has stages) and `percent` fills the bar.
 */
function InlineProgress({
  label,
  percent,
  tone,
}: {
  label: string | null;
  percent: number;
  tone: "active" | "retrying";
}) {
  return (
    <div className="flex items-center gap-2 mt-0.5">
      {label && (
        <p
          className={`text-xs shrink-0 ${
            tone === "retrying" ? "text-yellow-500" : "text-muted-foreground"
          }`}
        >
          {label}
        </p>
      )}
      <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ? `${label}: ${percent}%` : `${percent}%`}
          className={`h-full rounded-full transition-all duration-300 ${
            tone === "retrying" ? "bg-yellow-500" : "bg-blue-500"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">
        {percent}%
      </span>
    </div>
  );
}

function UploadStatusDetail({ upload }: { upload: uploadReducer.UploadEntry }) {
  switch (upload.status) {
    case "waiting":
      return (
        <InlineProgress label="Waiting for export" percent={0} tone="active" />
      );
    case "uploading":
      return (
        <InlineProgress
          label={uploadStageLabel(upload)}
          percent={upload.progress}
          tone="active"
        />
      );
    case "retrying":
      return (
        <InlineProgress
          label={`Retrying (attempt ${upload.retryCount + 1})`}
          percent={upload.progress}
          tone="retrying"
        />
      );
    case "success":
      return <SuccessDetail upload={upload} />;
    case "error":
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-destructive truncate">
            {upload.errorMessage}
          </span>
          {/* A child task's Video belongs to the job above it, not to a
              social post — the same reason a Publish offers no link here. */}
          {upload.uploadType !== "publish" && !upload.parentUploadId && (
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

/** Where a finished job landed, plus a link to it when there is one to give. */
function SuccessDetail({ upload }: { upload: uploadReducer.UploadEntry }) {
  switch (upload.uploadType) {
    case "buffer":
      return <SuccessBadge label="Sent to Buffer" />;
    case "export":
      // A per-Video task under a Publish did not stop at the export: it also
      // shipped the file to Dropbox.
      return (
        <SuccessBadge label={upload.parentUploadId ? "Uploaded" : "Exported"} />
      );
    case "publish":
      return <SuccessBadge label="Published" />;
    case "ai-hero":
      return (
        <SuccessBadge label="Posted to AI Hero">
          {upload.aiHeroSlug && (
            <SuccessLink href={`https://aihero.dev/${upload.aiHeroSlug}`}>
              View Post
            </SuccessLink>
          )}
        </SuccessBadge>
      );
    case "youtube":
      return (
        <SuccessBadge label="Complete">
          {upload.youtubeVideoId && (
            <SuccessLink
              href={`https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`}
            >
              YouTube Studio
            </SuccessLink>
          )}
        </SuccessBadge>
      );
    case "youtube-shorts":
    case "skills-changelog":
    case "render-vertical":
      return <SuccessBadge label="Complete" />;
  }
}

function SuccessBadge({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mt-0.5">
      <Badge
        variant="secondary"
        className="text-green-500 text-[10px] px-1.5 py-0"
      >
        {label}
      </Badge>
      {children}
    </div>
  );
}

function SuccessLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}
