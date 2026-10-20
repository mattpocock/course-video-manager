import { useContext, useEffect, useCallback } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { UploadContext } from "./upload-context";
import { UploadRow, type PostRowControls } from "./upload-row";
import { allDoneEta, estimateUploads } from "./upload-eta-schedule";
import { formatRemaining } from "./upload-eta";
import type { UploadEntry } from "./upload-entry";
import {
  postRetryOf,
  publishRecoveryHrefOf,
  visibleJobRows,
} from "@/features/jobs/jobs-selectors";
import { jobIdOfRow } from "@/features/jobs/jobs-reducer";
import { rowsInPickupOrder } from "@/features/jobs/jobs-pickup-order";
import { jobLogHref } from "@/features/jobs/job-wire";
import { SidecarDownBanner } from "@/features/jobs/sidecar-down-banner";
import { clockOffsetOf } from "@/features/jobs/jobs-timing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const {
    etaHistory,
    clock,
    jobs,
    dismissJob,
    retryJob,
    cancelJob,
    dismissFinishedJobs,
    clearFinished,
  } = useContext(UploadContext);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Every row is a background Job the Sidecar runs.
  const allEntries = visibleJobRows(jobs);
  /** A failed or cut-off post's check and Retry (posts never retry alone). */
  const postControls = (uploadId: string): PostRowControls | null => {
    const job = jobs.jobs[jobIdOfRow(uploadId)];
    const retry = job ? postRetryOf(job) : null;
    if (!job || !retry) return null;
    return {
      interrupted: job.status === "interrupted",
      check: job.postCheck,
      retry,
      onRetry: () => retryJob(job.id),
    };
  };
  /** A Publish that may have left a Pending Version: where it is reconciled. */
  const publishRecoveryHref = (uploadId: string): string | null => {
    const job = jobs.jobs[jobIdOfRow(uploadId)];
    return job ? publishRecoveryHrefOf(job) : null;
  };
  const hasUploads = allEntries.length > 0;

  // A child task is already counted inside its parent's bar, so only the
  // top-level jobs speak for the badge counts and the floating indicator.
  // A Job's child rows (an Autofill's Videos) nest under it the same way.
  // The top-level rows read in the order their work is picked up.
  const rootEntries: UploadEntry[] = rowsInPickupOrder(
    jobs,
    allEntries.filter((u) => !u.parentUploadId)
  );
  const childrenOf = (parentUploadId: string) =>
    allEntries.filter((u) => u.parentUploadId === parentUploadId);

  const activeUploads = rootEntries.filter(
    (u) =>
      u.status === "uploading" ||
      u.status === "retrying" ||
      u.status === "waiting"
  );
  const isActive = activeUploads.length > 0;

  // Re-read the clock every second while anything runs, so an ETA counts down
  // between progress events rather than only when one arrives.
  const [now, setNow] = useState(clock);
  useEffect(() => {
    if (!isActive) return;
    setNow(clock());
    const interval = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(interval);
  }, [isActive, clock]);
  // Each row's timings come from its Job Events, by the database's clock:
  // "now" is moved onto that clock too (`clockOffsetOf`).
  const etaRows: Record<string, UploadEntry> = Object.fromEntries(
    allEntries.map((row) => [row.uploadId, row])
  );
  const etas = estimateUploads(etaRows, {
    timings: jobs.timings,
    history: etaHistory,
    now: now - clockOffsetOf(jobs),
  });
  const allDoneMs = allDoneEta(etaRows, etas);

  const completedCount = rootEntries.filter(
    (u) => u.status === "success"
  ).length;
  const errorCount = rootEntries.filter((u) => u.status === "error").length;

  const aggregateProgress =
    activeUploads.length > 0
      ? Math.round(
          activeUploads.reduce((sum, u) => sum + u.progress, 0) /
            activeUploads.length
        )
      : 100;

  const strokeDashoffset =
    CIRCLE_CIRCUMFERENCE - (aggregateProgress / 100) * CIRCLE_CIRCUMFERENCE;

  // 5 seconds after everything finishes, the succeeded Jobs go (for good).
  // A failed Job waits for the author. Any render restarts the wait (the rows
  // are a new array each time), as it always has.
  useEffect(() => {
    if (!hasUploads || isActive) return;

    const timer = setTimeout(() => dismissFinishedJobs(), 5000);

    return () => clearTimeout(timer);
  }, [hasUploads, isActive, allEntries, dismissFinishedJobs]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent, uploadId: string) => {
      e.stopPropagation();
      dismissJob(uploadId);
    },
    [dismissJob]
  );

  const sidecarDown = (
    <SidecarDownBanner sidecar={jobs.sidecar} message={jobs.sidecarMessage} />
  );

  if (!hasUploads) return sidecarDown;

  return (
    <>
      {sidecarDown}
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
              {isActive && allDoneMs !== null && (
                <span className="text-xs font-normal text-muted-foreground">
                  all done in {formatRemaining(allDoneMs)}
                </span>
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
          {completedCount + errorCount > 0 && (
            <div className="flex justify-end -mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={clearFinished}
              >
                Clear finished
              </Button>
            </div>
          )}
          {jobs.sidecar === "not-running" && (
            <p
              role="status"
              className="text-xs text-yellow-600 dark:text-yellow-500"
              title={jobs.sidecarMessage ?? undefined}
            >
              The sidecar is not running: exports and renders wait in the queue
              until it starts (`pnpm dev` and `pnpm start` run it).
            </p>
          )}
          <div className="max-h-80 overflow-y-auto -mx-6 px-6">
            {rootEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No uploads
              </p>
            ) : (
              <div className="space-y-0 divide-y">
                {rootEntries.map((upload) => (
                  <div key={upload.uploadId}>
                    <UploadRow
                      upload={upload}
                      onDismiss={handleDismiss}
                      eta={etas[upload.uploadId]}
                      logHref={jobLogHref(jobIdOfRow(upload.uploadId))}
                      post={postControls(upload.uploadId)}
                      onCancel={() => cancelJob(jobIdOfRow(upload.uploadId))}
                      publishRecoveryHref={publishRecoveryHref(upload.uploadId)}
                      // Its link goes to another page: the dialog closes.
                      onFollowLink={() => setIsModalOpen(false)}
                    />
                    {childrenOf(upload.uploadId).map((child) => (
                      <UploadRow
                        key={child.uploadId}
                        upload={child}
                        onDismiss={handleDismiss}
                        nested
                        eta={etas[child.uploadId]}
                        logHref={null}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
