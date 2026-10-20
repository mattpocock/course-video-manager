import type { UploadEntry } from "./upload-entry";
import {
  AUTOFILL_WORK_BAND,
  BUFFER_STAGE_BANDS,
  DUPLICATE_COURSE_STAGE_BANDS,
  STORAGE_DELETE_STAGE_BANDS,
  STORAGE_MOVE_STAGE_BANDS,
  PUBLISH_VIDEO_UPLOAD_BANDS,
  PUBLISH_WORK_BAND,
  exportStageBands,
  isSettled,
  type StageBand,
} from "./upload-progress";

/**
 * The stage model the ETA is built on: which stage a job is in *for timing
 * purposes*, which stages it still has ahead of it, which of them stream a
 * real percentage, and how each is keyed in the persisted stage history.
 *
 * It is coarser than the display stages in one place: a Publish or Autofill
 * parent's middle is a single `work` stage, because that span is its
 * children's work and is estimated from them rather than from its own past.
 */

// The runners' pool sizes, mirrored from the server so a parent's estimate
// respects how many of its children actually run at once. A parity test pins
// each to its server constant.
/** `MAX_CONCURRENT_EXPORTS`: encodes, for both Export All and a Publish. */
export const EXPORT_POOL_CONCURRENCY = 6;
/** `DEFAULT_UPLOAD_CONCURRENCY`: a Publish's Dropbox upload pool. */
export const UPLOAD_POOL_CONCURRENCY = 8;
/** `AUTOFILL_CONCURRENCY`: Videos an Autofill writes at once. */
export const AUTOFILL_POOL_CONCURRENCY = 6;

export const ENCODE_STAGES = ["concatenating-clips", "normalizing-audio"];

/**
 * Stages that are waits, not work: a slot, a first event, or (for `work`) a
 * span estimated from children. They are never written to the history, and a
 * job sitting in one has no duration of its own to report.
 */
const WAIT_STAGES = new Set([
  "starting",
  "queued",
  "queued-for-upload",
  "work",
]);

export const isWaitStage = (stage: string) => WAIT_STAGES.has(stage);

/** A parent job: its bar, and its estimate, come from its children. */
export const isParentJob = (upload: UploadEntry) =>
  (upload.uploadType === "publish" || upload.uploadType === "autofill") &&
  !upload.parentUploadId;

/**
 * The job type as the history sees it. An Autofill's per-Video row shares the
 * `autofill` type with its parent but does entirely different work.
 */
const jobKind = (upload: UploadEntry) =>
  upload.uploadType === "autofill" && upload.parentUploadId
    ? "autofill-video"
    : upload.uploadType;

export const historyKey = (upload: UploadEntry, stage: string) =>
  `${jobKind(upload)}:${stage}`;

const hasUnsettledChildren = (
  parentUploadId: string,
  uploads: Record<string, UploadEntry>
) =>
  Object.values(uploads).some(
    (u) => u.parentUploadId === parentUploadId && !isSettled(u)
  );

/** The stage a job is in for timing, or `null` once it is not running. */
export const timingStage = (
  upload: UploadEntry,
  uploads: Record<string, UploadEntry>
): string | null => {
  if (upload.status !== "uploading") return null;
  switch (upload.uploadType) {
    case "export":
      return upload.videoUploadStage ?? upload.exportStage ?? "queued";
    case "buffer":
      return upload.bufferStage ?? "starting";
    case "render-vertical":
      return upload.renderVerticalStage ?? "starting";
    case "duplicate-course":
      return upload.duplicateCourseStage ?? "starting";
    case "storage-move":
      return upload.storageMoveStage ?? "starting";
    case "storage-delete":
      return upload.storageDeleteStage ?? "starting";
    case "publish": {
      const stage = upload.publishStage;
      if (!stage) return "starting";
      if (stage === "exporting" || stage === "uploading") {
        // Once every Video has settled, what is left is the Publish's own
        // commit — which is its own past, not its children's, to predict.
        return hasUnsettledChildren(upload.uploadId, uploads)
          ? "work"
          : "finalizing";
      }
      return stage === "complete" ? "finalizing" : stage;
    }
    case "autofill":
      if (upload.parentUploadId) return "writing";
      if (upload.autofillStage === "writing") return "work";
      return upload.autofillStage ?? "starting";
    case "youtube":
    case "youtube-shorts":
    case "ai-hero":
    case "skills-changelog":
      return "upload";
  }
};

/**
 * Every stage the job passes through, in order. `needsExport` matters only to
 * a Video under a Publish: one whose export is already on disk goes straight
 * to the upload pool.
 */
export const stagePlan = (
  upload: UploadEntry,
  needsExport: boolean
): readonly string[] => {
  switch (upload.uploadType) {
    case "export":
      if (!upload.parentUploadId) return ["queued", ...ENCODE_STAGES];
      return [
        "queued",
        ...(needsExport ? ENCODE_STAGES : []),
        "queued-for-upload",
        "uploading",
      ];
    case "buffer":
      return [
        "starting",
        "uploading-blob",
        "creating-post",
        "polling",
        "cleaning-up",
      ];
    case "duplicate-course":
      return ["starting", "copying-rows", "copying-files"];
    case "storage-move":
      return ["starting", "checking", "copying"];
    case "storage-delete":
      return ["starting", "checking", "deleting"];
    case "render-vertical":
      return [
        "starting",
        "concatenating-clips",
        "rendering-overlay",
        "compositing",
      ];
    case "publish":
      return [
        "starting",
        "validating",
        "freezing",
        "cloning",
        "work",
        "finalizing",
      ];
    case "autofill":
      return upload.parentUploadId
        ? ["writing"]
        : ["starting", "selecting", "work"];
    case "youtube":
    case "youtube-shorts":
    case "ai-hero":
    case "skills-changelog":
      return ["upload"];
  }
};

const WHOLE_BAR: StageBand = { start: 0, width: 100 };

/**
 * The slice of the bar a stage streams a real percentage into, or `null` for
 * a stage that only ever reports that it has started.
 */
export const stageBand = (
  upload: UploadEntry,
  stage: string
): StageBand | null => {
  switch (upload.uploadType) {
    case "export":
      if (stage === "uploading") return PUBLISH_VIDEO_UPLOAD_BANDS.uploading;
      if (stage === "concatenating-clips" || stage === "normalizing-audio") {
        return exportStageBands(upload)[stage];
      }
      return null;
    case "buffer":
      return stage === "uploading-blob"
        ? BUFFER_STAGE_BANDS["uploading-blob"]
        : null;
    case "publish":
      return stage === "work" ? PUBLISH_WORK_BAND : null;
    case "autofill":
      return stage === "work" ? AUTOFILL_WORK_BAND : null;
    case "render-vertical":
      return null;
    case "duplicate-course":
      return stage === "copying-files"
        ? DUPLICATE_COURSE_STAGE_BANDS["copying-files"]
        : null;
    case "storage-move":
      return stage === "copying" ? STORAGE_MOVE_STAGE_BANDS.copying : null;
    case "storage-delete":
      return stage === "deleting" ? STORAGE_DELETE_STAGE_BANDS.deleting : null;
    case "youtube":
    case "youtube-shorts":
    case "ai-hero":
    case "skills-changelog":
      return stage === "upload" ? WHOLE_BAR : null;
  }
};

/**
 * The size of a stage's work, where the client knows it — so a 1.7 GB upload
 * is predicted from a per-byte rate rather than from the average upload.
 */
export const stageUnits = (
  upload: UploadEntry,
  stage: string
): number | null =>
  upload.uploadType === "export" && stage === "uploading"
    ? upload.totalBytes
    : null;
