import type {
  AutofillStage,
  AutofillUploadEntry,
  DuplicateCourseUploadEntry,
  StorageDeleteUploadEntry,
  StorageMoveUploadEntry,
  BaseUploadEntry,
  ExportStage,
  ExportUploadEntry,
  PublishStage,
  PublishUploadEntry,
  RenderVerticalStage,
  UploadEntry,
  UploadStatus,
  UploadType,
} from "@/features/upload-manager/upload-entry";
import {
  AUTOFILL_STAGE_BANDS,
  AUTOFILL_WORK_BAND,
  DUPLICATE_COURSE_STAGE_BANDS,
  EXPORT_STAGE_BANDS,
  exportStageBands,
  fillBand,
  PUBLISH_STAGE_BANDS,
  PUBLISH_VIDEO_UPLOAD_BANDS,
  RENDER_VERTICAL_STAGE_BANDS,
  STORAGE_DELETE_STAGE_BANDS,
  STORAGE_MOVE_STAGE_BANDS,
  withDerivedParentProgress,
} from "@/features/upload-manager/upload-progress";
import {
  batchVideoRowId,
  isFinishedJob,
  type jobsReducer,
} from "./jobs-reducer";
import { isDuplicateCourseStage } from "./duplicate-course-job";
import {
  isStorageDeleteStage,
  isStorageMoveStage,
} from "@/packages/storage/client";
import {
  isPostingJobKind,
  mayLeavePendingVersion,
  publishPageHref,
} from "./job-wire";

/** The Jobs the author has not dismissed, oldest first by when this tab met them. */
export const visibleJobs = (state: jobsReducer.State): jobsReducer.JobView[] =>
  Object.values(state.jobs).filter((job) => !state.dismissed[job.id]);

/**
 * Every Upload Manager row the visible Jobs draw, minus the ones dismissed:
 * one per Job, or one per Video for a Batch export.
 */
export const visibleJobRows = (state: jobsReducer.State): UploadEntry[] =>
  visibleJobs(state)
    .flatMap(jobUploadEntries)
    .filter((row) => !state.dismissed[row.uploadId]);

/**
 * The newest visible row a Video's Jobs of `uploadType` draw: what a posting
 * page shows as "its" upload (a YouTube upload, an AI Hero post).
 */
export const findVideoJobRow = <T extends UploadType>(
  state: jobsReducer.State,
  videoId: string,
  uploadType: T
): Extract<UploadEntry, { uploadType: T }> | undefined =>
  visibleJobRows(state)
    .filter(
      (row): row is Extract<UploadEntry, { uploadType: T }> =>
        row.videoId === videoId && row.uploadType === uploadType
    )
    .at(-1);

const EXPORT_STAGES: readonly string[] = Object.keys(EXPORT_STAGE_BANDS);

const isExportStage = (stage: string): stage is ExportStage =>
  EXPORT_STAGES.includes(stage);

const RENDER_VERTICAL_STAGES: readonly string[] = Object.keys(
  RENDER_VERTICAL_STAGE_BANDS
);

const isRenderVerticalStage = (stage: string): stage is RenderVerticalStage =>
  RENDER_VERTICAL_STAGES.includes(stage);

const uploadStatusOf = (job: jobsReducer.JobView): UploadStatus => {
  switch (job.status) {
    case "requested":
      // Unanswered, being asked again: in progress, never failed.
      return job.errorMessage === null ? "uploading" : "retrying";
    case "running":
      return "uploading";
    case "queued":
      // A post waiting for its export draws as the browser's did: waiting.
      if (job.dependsOn !== null) return "waiting";
      // Back in the queue after a failed attempt is a retry; the first wait,
      // or a wait after a stopping sidecar put it back, is just a queue.
      return job.errorMessage === null ? "uploading" : "retrying";
    case "retrying":
      return "retrying";
    case "succeeded":
      return "success";
    case "failed":
    case "interrupted":
    case "cancelled":
      return "error";
  }
};

/** The fields every Job's row shares, whatever its kind. */
const baseEntryOf = (
  job: jobsReducer.JobView,
  status: UploadStatus,
  progress: number
): BaseUploadEntry => ({
  uploadId: job.id,
  videoId: job.subjectId ?? "",
  title: job.title,
  progress,
  status,
  errorMessage: job.errorMessage,
  retryCount: job.attempt - 1,
  terminal: false,
  dependsOn: job.dependsOn,
  parentUploadId: null,
});

const stringOf = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** An upload's bar: its percent while it runs, full once it is done. */
const uploadProgressOf = (job: jobsReducer.JobView, status: UploadStatus) =>
  status === "success" ? 100 : (job.percent ?? 0);

/**
 * A server Job as a row of the Global Upload Progress, which draws Upload
 * Manager entries. Each kind draws exactly as its browser-driven job did: the
 * same stages, bands and labels. `null` for a kind with no row.
 */
export const jobUploadEntry = (
  job: jobsReducer.JobView
): UploadEntry | null => {
  switch (job.kind) {
    case "buffer": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: "buffer",
        bufferStage:
          status === "success"
            ? null
            : job.stage === "creating-post"
              ? "creating-post"
              : "uploading-blob",
      };
    }
    case "ai-hero": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: "ai-hero",
        aiHeroSlug: stringOf(job.result?.slug),
      };
    }
    case "skills-changelog": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: "skills-changelog",
        skillsChangelogSlug: stringOf(job.result?.slug),
      };
    }
    case "youtube":
    case "youtube-shorts": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: job.kind,
        youtubeVideoId: stringOf(job.result?.youtubeVideoId),
      };
    }
    case "render-vertical": {
      const stage =
        job.stage !== null && isRenderVerticalStage(job.stage)
          ? job.stage
          : null;
      const status = uploadStatusOf(job);
      // A render reports stages, not percentages: each stage is a floor.
      const progress =
        status === "success"
          ? 100
          : stage === null
            ? 0
            : RENDER_VERTICAL_STAGE_BANDS[stage].start;
      return {
        ...baseEntryOf(job, status, progress),
        uploadType: "render-vertical",
        renderVerticalStage: status === "success" ? null : stage,
      };
    }
    // An Animatic export reports the export's own stage, and is drawn as one.
    case "export":
    case "export-animatic": {
      const stage =
        job.stage !== null && isExportStage(job.stage) ? job.stage : null;
      const status = uploadStatusOf(job);
      const progress =
        status === "success"
          ? 100
          : stage === null
            ? 0
            : fillBand(EXPORT_STAGE_BANDS[stage], job.percent ?? 0);
      return {
        ...baseEntryOf(job, status, progress),
        uploadType: "export",
        exportStage: status === "uploading" ? (stage ?? "queued") : stage,
        isBatchEntry: false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      };
    }
    case "duplicate-course":
      return duplicateCourseEntry(job);
    case "storage-move":
      return storageMoveEntry(job);
    case "storage-delete":
      return storageDeleteEntry(job);
    default:
      return null;
  }
};

/**
 * A Course duplicate: one row, about the NEW Course (its subject), whose bar
 * is the rows, then the files, a real percentage.
 */
const duplicateCourseEntry = (
  job: jobsReducer.JobView
): DuplicateCourseUploadEntry => {
  const stage =
    job.stage !== null && isDuplicateCourseStage(job.stage) ? job.stage : null;
  const status = uploadStatusOf(job);
  const progress =
    status === "success"
      ? 100
      : stage === null
        ? 0
        : fillBand(DUPLICATE_COURSE_STAGE_BANDS[stage], job.percent ?? 0);
  return {
    ...baseEntryOf(job, status, progress),
    // The row names a Course, not a Video.
    videoId: "",
    uploadType: "duplicate-course",
    duplicateCourseStage: status === "success" ? null : stage,
    courseId: job.subjectId ?? "",
  };
};

/**
 * A Storage move: one row about a Storage Bucket (its subject, not a Video),
 * checking then copying, a real percentage by bytes. Its row has a Cancel.
 */
const storageMoveEntry = (job: jobsReducer.JobView): StorageMoveUploadEntry => {
  const stage =
    job.stage !== null && isStorageMoveStage(job.stage) ? job.stage : null;
  const status = uploadStatusOf(job);
  const progress =
    status === "success"
      ? 100
      : stage === null
        ? 0
        : fillBand(STORAGE_MOVE_STAGE_BANDS[stage], job.percent ?? 0);
  const live =
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "retrying" ||
    job.status === "requested";
  return {
    ...baseEntryOf(job, status, progress),
    videoId: "",
    uploadType: "storage-move",
    storageMoveStage: status === "success" ? null : stage,
    cancellable: live && job.status !== "requested" && !job.cancelRequested,
    cancelRequested: live && job.cancelRequested,
    cancelled: job.status === "cancelled",
  };
};

/**
 * A Storage delete (#2110): one row about a Storage Bucket, checking then
 * deleting, a real percentage by bytes. Its row has a Cancel; its failure
 * message is "N deleted; N files still on D:, retry".
 */
const storageDeleteEntry = (
  job: jobsReducer.JobView
): StorageDeleteUploadEntry => {
  const stage =
    job.stage !== null && isStorageDeleteStage(job.stage) ? job.stage : null;
  const status = uploadStatusOf(job);
  const progress =
    status === "success"
      ? 100
      : stage === null
        ? 0
        : fillBand(STORAGE_DELETE_STAGE_BANDS[stage], job.percent ?? 0);
  const live =
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "retrying" ||
    job.status === "requested";
  return {
    ...baseEntryOf(job, status, progress),
    videoId: "",
    uploadType: "storage-delete",
    storageDeleteStage: status === "success" ? null : stage,
    cancellable: live && job.status !== "requested" && !job.cancelRequested,
    cancelRequested: live && job.cancelRequested,
    cancelled: job.status === "cancelled",
  };
};

/** A batch Video's row status, read with its batch's. */
const batchVideoStatusOf = (
  job: jobsReducer.JobView,
  video: jobsReducer.BatchVideoView
): UploadStatus => {
  switch (video.status) {
    case "succeeded":
      return "success";
    case "failed":
      return "error";
    case "queued":
    case "running":
    case "handed-off":
      // A batch that ended without finishing a Video leaves it failed.
      return isFinishedJob(job) && job.status !== "succeeded"
        ? "error"
        : "uploading";
  }
};

/**
 * The newest Job of `kind` about one subject (a Course's Autofill), known to
 * this tab — started here, or met in the stream's snapshot after a reload.
 */
export const latestJobFor = (
  state: jobsReducer.State,
  kind: string,
  subjectId: string
): jobsReducer.JobView | undefined =>
  Object.values(state.jobs)
    .filter((job) => job.kind === kind && job.subjectId === subjectId)
    .at(-1);

const AUTOFILL_STAGES: readonly string[] = Object.keys(AUTOFILL_STAGE_BANDS);

const isAutofillStage = (stage: string): stage is AutofillStage =>
  AUTOFILL_STAGES.includes(stage);

/**
 * A Course Autofill as the browser-driven run drew it: a parent row whose bar
 * is its Videos, and one child row per **Autofill Candidate** under it
 * (`parentUploadId`). A Video's row has no finer progress than "writing";
 * it ends filled or failed, never retried.
 */
const autofillUploadEntries = (
  job: jobsReducer.JobView
): AutofillUploadEntry[] => {
  const status = uploadStatusOf(job);
  const courseId = job.subjectId ?? "";
  const children = (job.videos ?? []).map((video): AutofillUploadEntry => {
    const videoStatus = batchVideoStatusOf(job, video);
    return {
      uploadId: batchVideoRowId(job.id, video.id),
      videoId: video.id,
      title: video.title,
      progress:
        videoStatus === "success" ? 100 : AUTOFILL_STAGE_BANDS.writing.start,
      status: videoStatus,
      errorMessage:
        video.errorMessage ??
        (videoStatus === "error" ? job.errorMessage : null),
      retryCount: 0,
      terminal: videoStatus === "error",
      dependsOn: null,
      parentUploadId: job.id,
      uploadType: "autofill",
      autofillStage: videoStatus === "success" ? null : "writing",
      courseId,
      kept: video.kept,
    };
  });
  const stage =
    job.stage !== null && isAutofillStage(job.stage) ? job.stage : null;
  // A Video that has settled, either way, is work done.
  const settled = children.filter(
    (child) => child.status === "success" || child.status === "error"
  ).length;
  const progress =
    status === "success"
      ? 100
      : stage === "writing" && children.length > 0
        ? fillBand(AUTOFILL_WORK_BAND, (100 * settled) / children.length)
        : stage === null
          ? 0
          : AUTOFILL_STAGE_BANDS[stage].start;
  const parent: AutofillUploadEntry = {
    ...baseEntryOf(job, status, progress),
    // The parent names a Course, not a Video.
    videoId: "",
    terminal: status === "error",
    uploadType: "autofill",
    autofillStage: status === "success" ? null : (stage ?? "selecting"),
    courseId,
    kept: [],
  };
  return [parent, ...children];
};

const PUBLISH_STAGES: readonly string[] = Object.keys(PUBLISH_STAGE_BANDS);

const isPublishStage = (stage: string): stage is PublishStage =>
  PUBLISH_STAGES.includes(stage);

/** One shipping Video of a Publish: its encode, then its upload. */
const publishVideoEntry = (
  job: jobsReducer.JobView,
  video: jobsReducer.BatchVideoView
): ExportUploadEntry => {
  const status = batchVideoStatusOf(job, video);
  const stage =
    video.stage !== null && isExportStage(video.stage) ? video.stage : null;
  const entry: ExportUploadEntry = {
    uploadId: batchVideoRowId(job.id, video.id),
    videoId: video.id,
    title: video.title,
    progress: 0,
    status,
    errorMessage:
      video.errorMessage ?? (status === "error" ? job.errorMessage : null),
    retryCount: 0,
    // The Publish already retried the export inside the service, and the
    // Publish itself fails with it: a Video's row is never retried alone.
    terminal: status === "error",
    dependsOn: null,
    parentUploadId: job.id,
    uploadType: "export",
    exportStage:
      status === "uploading" && video.uploadStage === null
        ? (stage ?? "queued")
        : video.uploadStage === null
          ? stage
          : null,
    isBatchEntry: true,
    videoUploadStage: status === "success" ? null : video.uploadStage,
    uploadedBytes: video.uploadedBytes,
    totalBytes: video.totalBytes,
  };
  const progress =
    status === "success"
      ? 100
      : video.uploadStage === "uploading"
        ? fillBand(
            PUBLISH_VIDEO_UPLOAD_BANDS.uploading,
            video.totalBytes && video.totalBytes > 0
              ? (100 * video.uploadedBytes) / video.totalBytes
              : 0
          )
        : video.uploadStage === "queued-for-upload"
          ? PUBLISH_VIDEO_UPLOAD_BANDS["queued-for-upload"].start
          : stage === null
            ? 0
            : fillBand(exportStageBands(entry)[stage], video.percent ?? 0);
  return { ...entry, progress };
};

/**
 * A **Publish** as the browser-driven run drew it: a parent row for the
 * Course, banded by the publish stages until its Videos are announced and
 * then the byte-weighted mean of them (`withDerivedParentProgress`), and one
 * child row per shipping Video, which encodes and then uploads.
 */
const publishUploadEntries = (job: jobsReducer.JobView): UploadEntry[] => {
  const status = uploadStatusOf(job);
  const stage =
    job.stage !== null && isPublishStage(job.stage) ? job.stage : null;
  const newDraftVersionId = stringOf(job.result?.newDraftVersionId);
  const parent: PublishUploadEntry = {
    ...baseEntryOf(
      job,
      status,
      status === "success"
        ? 100
        : stage === null
          ? 0
          : PUBLISH_STAGE_BANDS[stage].start
    ),
    // The parent names a Course, not a Video.
    videoId: "",
    terminal: status === "error",
    uploadType: "publish",
    publishStage: status === "success" ? null : (stage ?? "validating"),
    newDraftVersionId,
    courseId: job.subjectId ?? "",
  };
  const children = (job.videos ?? []).map((video) =>
    publishVideoEntry(job, video)
  );
  const derived = withDerivedParentProgress(
    Object.fromEntries(
      [parent, ...children].map((entry) => [entry.uploadId, entry])
    )
  );
  return [derived[parent.uploadId] ?? parent, ...children];
};

/**
 * The rows a Job draws. A Batch export draws one export row per Video, as
 * the browser-driven batch did (`isBatchEntry`); a Video it handed on is
 * drawn by its own export Job instead. An Autofill and a Publish draw a
 * parent row and a child row per Video. Every other kind draws one row.
 */
export const jobUploadEntries = (job: jobsReducer.JobView): UploadEntry[] => {
  if (job.kind === "autofill") return autofillUploadEntries(job);
  if (job.kind === "publish") return publishUploadEntries(job);
  if (job.kind !== "batch-export") {
    const entry = jobUploadEntry(job);
    return entry ? [entry] : [];
  }
  return (job.videos ?? []).flatMap((video): ExportUploadEntry[] => {
    if (video.status === "handed-off") return [];
    const status = batchVideoStatusOf(job, video);
    const stage =
      video.stage !== null && isExportStage(video.stage) ? video.stage : null;
    const progress =
      status === "success"
        ? 100
        : stage === null
          ? 0
          : fillBand(EXPORT_STAGE_BANDS[stage], video.percent ?? 0);
    return [
      {
        uploadId: batchVideoRowId(job.id, video.id),
        videoId: video.id,
        title: video.title,
        progress,
        status,
        errorMessage:
          video.errorMessage ?? (status === "error" ? job.errorMessage : null),
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
        uploadType: "export",
        exportStage: status === "uploading" ? (stage ?? "queued") : stage,
        isBatchEntry: true,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      },
    ];
  });
};

/**
 * Failures a Retry cannot fix: a dead or missing key (fix it, then post again
 * from the page), or an export that never finished (its post never started).
 */
const RETRY_CANNOT_HELP: readonly string[] = [
  "BufferAuthError",
  "NotAuthenticatedError",
  "YouTubeAuthError",
  "AiHeroNotAuthenticatedError",
  "DependencyFailed",
];

/** A failure from before the post sent anything: nothing can have gone out. */
const NOTHING_SENT: readonly string[] = ["PostNotStartedError"];

/**
 * What a failed or cut-off POST's row offers (decision 5: "Posting twice
 * would be disastrous"), or `null` for any other Job.
 *
 * - `went-out`: this run's post reached the service — it said so (`posted`)
 *   before it failed, or the post-check found it. No Retry: it would post
 *   twice (the server refuses it too).
 * - `cannot-help`: fix the key, or the export, then post again from the page.
 * - `retry`: asks "Post again?" first unless the failure came before anything
 *   was sent. A "not posted" check does not skip the question: a check can
 *   run before a cut-off request has landed, and a failed run is never
 *   looked for at all.
 */
export type PostRetry =
  | { readonly type: "went-out"; readonly url: string | null }
  | { readonly type: "cannot-help" }
  | { readonly type: "retry"; readonly confirm: boolean };

export const postRetryOf = (job: jobsReducer.JobView): PostRetry | null => {
  if (!isPostingJobKind(job.kind)) return null;
  if (job.status !== "failed" && job.status !== "interrupted") return null;
  if (job.result !== null) {
    return { type: "went-out", url: stringOf(job.result.url) };
  }
  if (job.postCheck?.verdict === "posted") {
    return { type: "went-out", url: job.postCheck.url };
  }
  if (RETRY_CANNOT_HELP.includes(job.errorTag ?? "")) {
    return { type: "cannot-help" };
  }
  return {
    type: "retry",
    confirm: !NOTHING_SENT.includes(job.errorTag ?? ""),
  };
};

/**
 * Where a settled Publish's Pending Version is Promoted or Discarded, by hand
 * (plan section 7.2), or `null` when it cannot have left one: still running,
 * succeeded, failed before Submit, or failed in a way the service already
 * Discarded.
 */
export const publishRecoveryHrefOf = (
  job: jobsReducer.JobView
): string | null => {
  if (job.kind !== "publish" || !job.subjectId) return null;
  return mayLeavePendingVersion(job) ? publishPageHref(job.subjectId) : null;
};
